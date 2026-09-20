/* SU Parking - client-side app.
 *
 * Status logic mirrors parking/rules.py (rules are declarative data, so the two
 * stay in sync). This file also adds:
 *   - an owner filter (SU only / all nearby parking), and
 *   - optional crowdsourced fullness via Supabase (see site/config.js).
 */

const cfg = window.SU_PARKING_CONFIG || {};
const CROWD_ENABLED = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const REPORT_WINDOW_MIN = cfg.REPORT_WINDOW_MIN || 90;
const REPORT_COOLDOWN_MIN = cfg.REPORT_COOLDOWN_MIN || 5;

const STATUS = {
  OPEN: { key: "open", label: "Open to you now" },
  PERMIT_ONLY: { key: "permit_only", label: "Permit required" },
  RESTRICTED: { key: "restricted", label: "Restricted right now" },
  CLOSED: { key: "closed", label: "Not available to you" },
};

const STATUS_COLOR = {
  open: "#f76900", permit_only: "#b06a12",
  restricted: "#a5232c", closed: "#7b828c",
};

const OWNER_LABEL = { su: "Syracuse University", city: "City", private: "Private" };
const CROWD_LABEL = { full: "Reported full", some: "Some spots", open: "Reported open" };
const CROWD_COLOR = { full: "#a5232c", some: "#b06a12", open: "#2e7d32" };

const state = {
  data: null,
  permit: localStorage.getItem("su-permit") || "commuter",
  ownerFilter: localStorage.getItem("su-owner-filter") || "all",
  map: null,
  markers: new Map(),
  reports: new Map(), // lot_id -> { status, count, latestMinAgo }
};

/* ---- rules engine (mirror of parking/rules.py) ---- */

function parseHHMM(v) { const [h, m] = v.split(":").map(Number); return h * 60 + m; }
function minutesOfDay(d) { return d.getHours() * 60 + d.getMinutes(); }
function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6; }
function winterOddEvenActive(d) { return [11, 12, 1, 2, 3].includes(d.getMonth() + 1); }
function fmtTime(min) {
  let h = Math.floor(min / 60); const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}
function domeEventActive(date, events) {
  for (const ev of events) {
    if (date >= new Date(ev.restriction_start) && date <= new Date(ev.restriction_end)) return ev;
  }
  return null;
}

function evaluateLot(lot, permit, date, events) {
  if (lot.dome_restricted) {
    const ev = domeEventActive(date, events);
    if (ev) {
      const end = new Date(ev.restriction_end)
        .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return { ...STATUS.RESTRICTED, reason: `Closed for ${ev.name} until ${end}.` };
    }
  }
  if (lot.public_hourly) {
    return { ...STATUS.OPEN, reason: "Open to the public for hourly parking - pay at the gate." };
  }
  if ((lot.permits || []).includes(permit)) {
    return { ...STATUS.OPEN, reason: "Your permit is assigned to this lot." };
  }
  if (lot.category === "orange" && permit !== "visitor") {
    const after = parseHHMM(lot.orange_after || "16:30");
    if (isWeekend(date)) return { ...STATUS.OPEN, reason: "Orange lot - open to any valid permit on weekends." };
    if (minutesOfDay(date) >= after) return { ...STATUS.OPEN, reason: `Orange lot - open to any valid permit after ${fmtTime(after)} on weekdays.` };
    return { ...STATUS.PERMIT_ONLY, reason: `Orange lot - opens to any valid permit at ${fmtTime(after)} on weekdays.` };
  }
  if (lot.category === "street") {
    let note = "City street parking - pay until 6:00 PM.";
    if (winterOddEvenActive(date)) note += " Winter odd/even rules in effect (Nov 1 - Apr 1).";
    return { ...STATUS.OPEN, reason: note };
  }
  return { ...STATUS.PERMIT_ONLY, reason: "Requires an assigned permit for this lot." };
}

/* ---- crowd reports (optional, Supabase) ---- */

function aggregateReports(list) {
  const now = Date.now();
  const weights = { full: 0, some: 0, open: 0 };
  let count = 0, minAge = Infinity;
  for (const r of list) {
    const ageMin = (now - new Date(r.created_at).getTime()) / 60000;
    if (ageMin > REPORT_WINDOW_MIN) continue;
    weights[r.status] += Math.max(0, 1 - ageMin / REPORT_WINDOW_MIN);
    count += 1;
    minAge = Math.min(minAge, ageMin);
  }
  if (count === 0) return null;
  const status = Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0];
  return { status, count, latestMinAgo: Math.round(minAge) };
}

async function fetchReports() {
  if (!CROWD_ENABLED) return;
  const since = new Date(Date.now() - REPORT_WINDOW_MIN * 60000).toISOString();
  const url = `${cfg.SUPABASE_URL}/rest/v1/reports`
    + `?select=lot_id,status,created_at&created_at=gte.${since}&order=created_at.desc`;
  try {
    const res = await fetch(url, {
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    const byLot = new Map();
    for (const row of rows) {
      if (!byLot.has(row.lot_id)) byLot.set(row.lot_id, []);
      byLot.get(row.lot_id).push(row);
    }
    state.reports = new Map();
    for (const [lotId, list] of byLot) {
      const agg = aggregateReports(list);
      if (agg) state.reports.set(lotId, agg);
    }
  } catch (err) {
    console.warn("Could not load crowd reports:", err);
  }
}

async function submitReport(lotId, status) {
  const key = `report:${lotId}`;
  const last = Number(localStorage.getItem(key) || 0);
  if (Date.now() - last < REPORT_COOLDOWN_MIN * 60000) {
    return { ok: false, reason: `You just reported this lot - try again in a few minutes.` };
  }
  try {
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/reports`, {
      method: "POST",
      headers: {
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ lot_id: lotId, status }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    localStorage.setItem(key, String(Date.now()));
    return { ok: true };
  } catch (err) {
    console.warn("Report failed:", err);
    return { ok: false, reason: "Couldn't submit - check your connection." };
  }
}

/* ---- UI building ---- */

function buildPermitPicker() {
  const host = document.getElementById("permit-picker");
  host.innerHTML = "";
  for (const permit of state.data.permits) {
    const btn = document.createElement("button");
    btn.className = "permit__btn";
    btn.textContent = permit.label;
    btn.dataset.permit = permit.id;
    btn.setAttribute("aria-pressed", String(permit.id === state.permit));
    btn.addEventListener("click", () => {
      state.permit = permit.id;
      localStorage.setItem("su-permit", permit.id);
      render();
    });
    host.appendChild(btn);
  }
}

function buildOwnerFilter() {
  const host = document.getElementById("owner-filter");
  host.innerHTML = "";
  const options = [["all", "All parking"], ["su", "SU only"]];
  for (const [value, label] of options) {
    const btn = document.createElement("button");
    btn.className = "filter__btn";
    btn.textContent = label;
    btn.dataset.owner = value;
    btn.setAttribute("aria-pressed", String(value === state.ownerFilter));
    btn.addEventListener("click", () => {
      state.ownerFilter = value;
      localStorage.setItem("su-owner-filter", value);
      render();
    });
    host.appendChild(btn);
  }
}

function buildLegend() {
  document.getElementById("legend").innerHTML = [
    ["open", "Open to you"], ["permit_only", "Permit needed"],
    ["restricted", "Event restricted"], ["closed", "Not for your permit"],
  ].map(([k, l]) => `<span><i class="dot dot--${k}"></i>${l}</span>`).join("");
}

function crowdBadge(agg) {
  if (!CROWD_ENABLED) return "";
  if (!agg) return `<span class="crowd crowd--none">No recent reports</span>`;
  const ago = agg.latestMinAgo <= 0 ? "just now" : `${agg.latestMinAgo} min ago`;
  return `<span class="crowd" style="color:${CROWD_COLOR[agg.status]}">
      ${CROWD_LABEL[agg.status]} &middot; ${agg.count} report${agg.count > 1 ? "s" : ""}, latest ${ago}
    </span>`;
}

function reportButtons(lotId) {
  if (!CROWD_ENABLED) return "";
  const opts = [["open", "Open"], ["some", "Some"], ["full", "Full"]];
  const buttons = opts.map(([s, l]) =>
    `<button class="rep rep--${s}" data-report="${s}" data-lot="${lotId}">${l}</button>`
  ).join("");
  return `<div class="reprow"><span class="reprow__label">Is it full?</span>${buttons}</div>`;
}

function initMap() {
  state.map = L.map("map", { scrollWheelZoom: true }).setView([43.043, -76.142], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
  }).addTo(state.map);
}

function visibleLots() {
  if (state.ownerFilter === "su") return state.data.lots.filter((l) => l.owner === "su");
  return state.data.lots;
}

function render() {
  if (!state.data) return;
  const now = new Date();
  const events = state.data.events || [];

  document.getElementById("clock").textContent = now.toLocaleString([], {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  document.querySelectorAll(".permit__btn").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.permit === state.permit)));
  document.querySelectorAll(".filter__btn").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.owner === state.ownerFilter)));

  const shown = visibleLots();
  const shownIds = new Set(shown.map((l) => l.id));
  const listHost = document.getElementById("lot-list");
  listHost.innerHTML = "";
  let openCount = 0;

  const evaluated = shown.map((lot) => ({ lot, result: evaluateLot(lot, state.permit, now, events) }));
  evaluated.sort((a, b) =>
    (a.result.key !== "open") - (b.result.key !== "open") || a.lot.name.localeCompare(b.lot.name));

  for (const { lot, result } of evaluated) {
    if (result.key === "open") openCount += 1;
    const agg = state.reports.get(lot.id) || null;

    const li = document.createElement("li");
    li.className = `lot lot--${result.key}`;
    li.innerHTML = `
      <div class="lot__top">
        <span class="lot__name">${lot.name}</span>
        <span class="lot__status lot__status--${result.key}">${result.label}</span>
      </div>
      <div class="lot__meta">
        <span class="owner owner--${lot.owner}">${OWNER_LABEL[lot.owner] || lot.owner}</span>
        <span class="lot__type">${lot.type}</span>
        ${lot.price ? `<span class="lot__price">${lot.price}</span>` : ""}
      </div>
      <p class="lot__reason">${result.reason}</p>
      ${lot.sold_out ? '<span class="lot__flag">Season permits sold out</span>' : ""}
      <div class="lot__crowd">${crowdBadge(agg)}</div>
      ${reportButtons(lot.id)}
    `;
    li.querySelectorAll("[data-report]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        const out = await submitReport(btn.dataset.lot, btn.dataset.report);
        if (!out.ok) { btn.disabled = false; alert(out.reason); return; }
        await fetchReports();
        render();
      });
    });
    li.addEventListener("click", () => {
      const m = state.markers.get(lot.id);
      if (m) { state.map.setView([lot.lat, lot.lon], 16); m.openPopup(); }
    });
    listHost.appendChild(li);

    let marker = state.markers.get(lot.id);
    if (!marker) {
      marker = L.circleMarker([lot.lat, lot.lon], { radius: 9, weight: 2, fillOpacity: 0.95 });
      state.markers.set(lot.id, marker);
    }
    marker.setStyle({
      fillColor: STATUS_COLOR[result.key],
      color: lot.owner === "su" ? "#ffffff" : "#0a2240", // non-SU get a navy ring
    });
    const crowdLine = CROWD_ENABLED && agg
      ? `<div class="pop__crowd" style="color:${CROWD_COLOR[agg.status]}">${CROWD_LABEL[agg.status]} (${agg.count})</div>` : "";
    marker.bindPopup(
      `<div class="pop__name">${lot.name}</div>
       <div class="pop__owner">${OWNER_LABEL[lot.owner] || lot.owner}${lot.price ? " &middot; " + lot.price : ""}</div>
       <div class="pop__status" style="color:${STATUS_COLOR[result.key]}">${result.label}</div>
       <div class="pop__reason">${result.reason}</div>${crowdLine}`
    );
    if (!state.map.hasLayer(marker)) marker.addTo(state.map);
  }

  // Remove markers for lots hidden by the filter.
  for (const [id, marker] of state.markers) {
    if (!shownIds.has(id) && state.map.hasLayer(marker)) state.map.removeLayer(marker);
  }

  const permitLabel = state.data.permits.find((p) => p.id === state.permit)?.label || state.permit;
  document.getElementById("tally").innerHTML =
    `<b>${openCount}</b> of ${shown.length} shown lots open to a ${permitLabel.toLowerCase()} now`;

  const gen = state.data.generated_at ? new Date(state.data.generated_at) : null;
  document.getElementById("freshness").textContent =
    (gen ? `Data built ${gen.toLocaleString()}. ` : "") + `Source: ${state.data.source}`;
}

async function main() {
  initMap();
  try {
    const res = await fetch("data/bundle.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    document.getElementById("tally").textContent =
      "Couldn't load parking data. Run `python scripts/build_site.py` to generate it.";
    console.error(err);
    return;
  }
  buildPermitPicker();
  buildOwnerFilter();
  buildLegend();
  if (CROWD_ENABLED) await fetchReports();
  render();
  setInterval(render, 60 * 1000);
  if (CROWD_ENABLED) setInterval(async () => { await fetchReports(); render(); }, 60 * 1000);
}

main();
