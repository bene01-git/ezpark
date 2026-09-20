# Introducing EZPark!

A rules-based tool for whether you can park in **Syracuse University** and adjacent lots and
garages *right now* — based on your permit type, the time of day, the day of
week, and Dome/event restrictions.

> **This does not show live open spaces.** SU publishes no real-time occupancy
> feed, so no honest app can. Instead this evaluates the university's published
> **access rules** (permit eligibility, the "Orange lot after 4:30 p.m." rule,
> Dome event closures, winter odd/even street parking) to tell you whether a lot
> is *open to you* at a given moment. Always confirm with
> [Parking & Transportation Services](https://parking.syr.edu).

## How it's built

GitHub Pages only serves static files — it can't run Python when someone visits.
So Python runs in **GitHub Actions** instead: on a schedule and on every push it
fetches data, rebuilds a static JSON bundle, and publishes the `site/` folder to
Pages. The browser reads that bundle and does the live "can I park now" math
client-side.

```
data/lots.json      hand-authored access rules (source of truth)
data/events.json    Dome/event restriction windows
        │
        ├── scripts/fetch_osm.py      → data/osm_parking.geojson   (OpenStreetMap geometry)
        ├── scripts/scrape_soldout.py → data/sold_out.json         (SU sold-out permit list)
        └── scripts/build_site.py     → site/data/bundle.json      (merged, what the site reads)
                                          │
                                   site/index.html + app.js + style.css   (Leaflet map + list)
                                          │
                              .github/workflows/update-data.yml  (runs it all, deploys to Pages)
```

The rules engine lives in `parking/rules.py` and is mirrored in `site/app.js`.
The rules are **declarative data**, so both interpreters stay small and in sync.

## Which of the earlier points this covers

- **Locations** — real geometry pulled from OpenStreetMap (`fetch_osm.py`); the
  16 named SU lots/garages are seeded with approximate coordinates that the OSM
  fetch replaces.
- **Rules & permits** — compiled from parking.syr.edu into `data/lots.json`.
- **Events** — Dome/football restriction windows in `data/events.json`.
- **"Live-ish" data** — a daily Action scrapes the sold-out permit list.
- **Hosting** — entirely on GitHub (Actions + Pages), no server, no paid APIs.

## Run it locally

```bash
pip install -r requirements.txt

# rebuild the site bundle from the data files
python scripts/build_site.py

# ask the engine from the command line
python -m parking.cli now --permit commuter
python -m parking.cli check --permit resident_grad --lot irving_ave_garage
python -m parking.cli lots

# run the tests
pytest -q

# preview the site (Leaflet + tiles need internet)
python -m http.server -d site 8000   # then open http://localhost:8000
```

To refresh the live-ish data yourself:

```bash
python scripts/fetch_osm.py        # OpenStreetMap geometry
python scripts/scrape_soldout.py   # SU sold-out permit list
python scripts/build_site.py       # rebuild the bundle
```

## Deploy to GitHub Pages

1. Create a repo and push this folder to the `main` branch.
2. In **Settings → Pages**, set **Source = GitHub Actions**.
3. Push (or run the workflow manually under **Actions → Refresh data and
   deploy → Run workflow**). The workflow tests, refreshes data, builds, and
   publishes. Your site appears at `https://<you>.github.io/<repo>/`.

The `schedule:` cron in `.github/workflows/update-data.yml` re-runs daily to keep
the sold-out list current. Adjust the cadence there.

## Editing the data

- **Add/adjust a lot or its rules** → edit `data/lots.json`. Fields:
  `category` (`orange` / `permit` / `public` / `street`), `permits` (who holds a
  valid permit there), `orange_after` (when Orange access starts), `public_hourly`,
  `dome_restricted`. Coordinates get overwritten by the OSM fetch.
- **Add an event** → add a window to `data/events.json`
  (`restriction_start` / `restriction_end`, ISO 8601, local time). You could
  extend `scripts/` to scrape the athletics schedule automatically.
- **Permit types** → the `permits` list in `data/lots.json`.

## Nearby non-SU garages

The app now shows city and private downtown garages alongside SU lots. Each lot
has an `owner` field (`su` / `city` / `private`), and the header has a
**Show: All parking / SU only** filter. Non-SU markers get a navy ring; SU
markers a white one.

Two sources feed this, both free:

- **Geometry** — `scripts/fetch_osm.py` now covers a wider bounding box that
  includes downtown, so the OpenStreetMap fetch picks up city/private garages
  automatically.
- **Names, owners, prices** — hand-compiled into `data/lots.json` from the
  Downtown Committee of Syracuse listings. Prices are approximate; verify them.

To add another garage, copy an existing downtown entry in `data/lots.json`, set
its `owner`, `category` (`public` for pay-hourly), `public_hourly: true`,
`lat`/`lon`, and optional `price` / `reservable` / `url`.

## Crowdsourced fullness (optional)

Users can tap **Open / Some / Full** on each lot to report how full it is, and
the app shows a recent consensus (weighted by how fresh the reports are). This
is the only realistic way to get live-ish occupancy, since no official feed
exists. It's **off until you configure it**, and the app works fine without it.

To turn it on:

1. Create a free project at <https://supabase.com>.
2. Open the Supabase **SQL Editor**, paste in `supabase/schema.sql`, and Run it.
   That creates a `reports` table with row-level security allowing only
   anonymous inserts and reads.
3. In Supabase go to **Settings → API** and copy the **Project URL** and the
   **anon public key**.
4. Paste both into `site/config.js`, commit, and push.

The anon key is designed to be public — it's safe in the browser because the
policies forbid updates and deletes. A per-browser cooldown
(`REPORT_COOLDOWN_MIN`) limits spamming; reports older than `REPORT_WINDOW_MIN`
stop counting. For heavier abuse protection you'd add a serverless function or
Supabase Edge Function, but the defaults are fine to start.

Note: crowd fullness is shown *separately* from the permit/time rules — a lot
can be "Open to you now" by the rules and "Reported full" by the crowd at the
same time. They answer different questions (may I park here vs. is there space).

## Accuracy & etiquette

The encoded rules are a **simplified model** of official policy and can go out
of date; treat results as a hint, not gospel. The scraper runs at most daily and
sends a descriptive User-Agent — keep it gentle and check each source's terms
before scraping more aggressively.

## License / attribution

Map data © OpenStreetMap contributors (ODbL). Parking rules © Syracuse
University; this is an unofficial project and is not affiliated with or endorsed
by the university.
