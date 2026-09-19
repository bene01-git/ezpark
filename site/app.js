/* SU Parking - client-side app.
 *
 * The status logic below is a faithful mirror of parking/rules.py. Because the
 * lot rules are declarative data (data/lots.json -> site/data/bundle.json), this
 * interpreter stays small and the two implementations are easy to keep in sync.
 * Live "now" evaluation has to happen in the browser, so it lives here.
 */

const STATUS = {
  OPEN: { key: "open", label: "Open to you now" },
  PERMIT_ONLY: { key: "permit_only", label: "Permit required" },
  RESTRICTED: { key: "restricted", label: "Restricted right now" },
  CLOSED: { key: "closed", label: "Not available to you" },
};

const STATUS_COLOR = {
  open: "#f76900",
  permit_only: "#b06a12",
  restricted: "#a5232c",
  closed: "#7b828c",
};

const state = {
  data: null,
  permit: localStorage.getItem("su-permit") || "commuter",
  map: null,
  markers: new Map(),
};

/* ---- rules engine (mirror of parking/rules.py) ---- */

function parseHHMM(value) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function isWeekend(date) {
  const d = date.getDay(); // 0 Sun ... 6 Sat
  return d === 0 || d === 6;
}

function domeEventActive(date, events) {
  for (const ev of events) {
    const start = new Date(ev.restriction_start);
    const end = new Date(ev.restriction_end);
    if (date >= start && date <= end) return ev;
  }
  return null;
}

function winterOddEvenActive(date) {
  const m = date.getMonth() + 1;
  return [11, 12, 1, 2, 3].includes(m);
}

function fmtTime(minutes) {
  let h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

function evaluateLot(lot, permit, date, events) {
  // 1. Dome / event restriction.
  if (lot.dome_restricted) {
    const ev = domeEventActive(date, events);
    if (ev) {
      const end = new Date(ev.restriction_end);
      const endStr = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return { ...STATUS.RESTRICTED, reason: `Closed for ${ev.name} until ${endStr}.` };
    }
  }
  // 2. Public hourly.
  if (lot.public_hourly) {
    return { ...STATUS.OPEN, reason: "Open to the public for hourly parking - pull a ticket at the gate." };
  }
  // 3. Held permit valid here.
  if ((lot.permits || []).includes(permit)) {
    return { ...STATUS.OPEN, reason: "Your permit is assigned to this lot." };
  }
  // 4. Orange lot rule.
  if (lot.category === "orange" && permit !== "visitor") {
    const after = parseHHMM(lot.orange_after || "16:30");
    if (isWeekend(date)) {
      return { ...STATUS.OPEN, reason: "Orange lot - open to any valid permit on weekends." };
    }
    if (minutesOfDay(date) >= after) {
      return { ...STATUS.OPEN, reason: `Orange lot - open to any valid permit after ${fmtTime(after)} on weekdays.` };
    }
    return { ...STATUS.PERMIT_ONLY, reason: `Orange lot - opens to any valid permit at ${fmtTime(after)} on weekdays.` };
  }
  // 5. Street parking.
  if (lot.category === "street") {
    let note = "City street parking - pay until 6:00 PM.";
    if (winterOddEvenActive(date)) note += " Winter odd/even rules are in effect (Nov 1 - Apr 1).";
    return { ...STATUS.OPEN, reason: note };
  }
  // 6. Needs a permit not held.
  return { ...STATUS.PERMIT_ONLY, reason: "Requires an assigned permit for this lot." };
}

/* ---- rendering ---- */

function buildPermitPicker() {
  const host = document.getElementById("permit-picker");
  host.innerHTML = "";
  for (const permit of state.data.permits) {
    const btn = document.createElement("button");
    btn.className = "permit__btn";
    btn.textContent = permit.label;
    btn.setAttribute("aria-pressed", String(permit.id === state.permit));
    btn.addEventListener("click", () => {
      state.permit = permit.id;
      localStorage.setItem("su-permit", permit.id);
      render();
    });
    host.appendChild(btn);
  }
}

function buildLegend() {
  const host = document.getElementById("legend");
  const items = [
    ["open", "Open to you"],
    ["permit_only", "Permit needed"],
    ["restricted", "Event restricted"],
    ["closed", "Not for your permit"],
  ];
  host.innerHTML = items
    .map(([k, label]) => `<span><i class="dot dot--${k}"></i>${label}</span>`)
    .join("");
}

function initMap() {
  state.map = L.map("map", { scrollWheelZoom: true }).setView([43.037, -76.134], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(state.map);
}

function render() {
  if (!state.data) return;
  const now = new Date();
  const events = state.data.events || [];

  // clock
  document.getElementById("clock").textContent = now.toLocaleString([], {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  // permit picker pressed state
  document.querySelectorAll(".permit__btn").forEach((btn) => {
    const permit = state.data.permits.find((p) => p.label === btn.textContent);
    btn.setAttribute("aria-pressed", String(permit && permit.id === state.permit));
  });

  const listHost = document.getElementById("lot-list");
  listHost.innerHTML = "";
  let openCount = 0;

  const evaluated = state.data.lots.map((lot) => ({
    lot,
    result: evaluateLot(lot, state.permit, now, events),
  }));
  evaluated.sort((a, b) =>
    (a.result.key !== "open") - (b.result.key !== "open") ||
    a.lot.name.localeCompare(b.lot.name));

  for (const { lot, result } of evaluated) {
    if (result.key === "open") openCount += 1;

    // list card
    const li = document.createElement("li");
    li.className = `lot lot--${result.key}`;
    li.innerHTML = `
      <div class="lot__top">
        <span class="lot__name">${lot.name}</span>
        <span class="lot__status lot__status--${result.key}">${result.label}</span>
      </div>
      <div class="lot__type">${lot.type}${lot.notes ? " · " + lot.notes : ""}</div>
      <p class="lot__reason">${result.reason}</p>
      ${lot.sold_out ? '<span class="lot__flag">Season permits sold out</span>' : ""}
    `;
    li.addEventListener("click", () => {
      const marker = state.markers.get(lot.id);
      if (marker) {
        state.map.setView([lot.lat, lot.lon], 16);
        marker.openPopup();
      }
    });
    listHost.appendChild(li);

    // map marker
    let marker = state.markers.get(lot.id);
    if (!marker) {
      marker = L.circleMarker([lot.lat, lot.lon], {
        radius: 9, weight: 2, color: "#fff", fillOpacity: 0.95,
      }).addTo(state.map);
      state.markers.set(lot.id, marker);
    }
    marker.setStyle({ fillColor: STATUS_COLOR[result.key] });
    marker.bindPopup(
      `<div class="pop__name">${lot.name}</div>
       <div class="pop__status" style="color:${STATUS_COLOR[result.key]}">${result.label}</div>
       <div class="pop__reason">${result.reason}</div>`
    );
  }

  // tally
  const permitLabel = state.data.permits.find((p) => p.id === state.permit)?.label || state.permit;
  document.getElementById("tally").innerHTML =
    `<b>${openCount}</b> of ${state.data.lots.length} lots open to a ${permitLabel.toLowerCase()} now`;

  // freshness
  const gen = state.data.generated_at ? new Date(state.data.generated_at) : null;
  document.getElementById("freshness").textContent =
    (gen ? `Data built ${gen.toLocaleString()}. ` : "") +
    `Source: ${state.data.source}`;
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
  buildLegend();
  render();
  // Recompute every minute so status flips as time passes.
  setInterval(render, 60 * 1000);
}

main();
