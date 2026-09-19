"""Build the static data bundle the frontend consumes.

Merges the hand-authored rules (data/lots.json, data/events.json), the scraped
sold-out list (data/sold_out.json, optional) and the OSM geometry
(data/osm_parking.geojson, optional) into site/data/bundle.json.

The browser then reads that one file and does live status evaluation client
side (mirroring parking/rules.py), so the site is fully static.

    python scripts/build_site.py
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUT_DIR = ROOT / "site" / "data"


def _load(name: str, default):
    path = DATA_DIR / name
    if not path.exists():
        return default
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def build() -> dict:
    lots_doc = _load("lots.json", {"lots": [], "permits": []})
    events_doc = _load("events.json", {"events": []})
    sold_out_doc = _load("sold_out.json", {"sold_out": []})

    sold_out_names = set(sold_out_doc.get("sold_out", []))
    lots = lots_doc["lots"]

    # Flag sold-out permit lots by name match.
    for lot in lots:
        lot["sold_out"] = lot["name"] in sold_out_names

    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": lots_doc.get("_source", "https://parking.syr.edu"),
        "permits": lots_doc["permits"],
        "lots": lots,
        "events": events_doc["events"],
        "sold_out_updated": sold_out_doc.get("generated_at"),
    }


def main() -> int:
    bundle = build()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_DIR / "bundle.json", "w", encoding="utf-8") as handle:
        json.dump(bundle, handle, indent=2)

    # Pass the OSM polygons through as an optional map layer if present.
    osm = _load("osm_parking.geojson", None)
    if osm is not None:
        with open(OUT_DIR / "osm_parking.geojson", "w", encoding="utf-8") as h:
            json.dump(osm, h)

    print(
        f"Built bundle with {len(bundle['lots'])} lots, "
        f"{len(bundle['events'])} events -> {OUT_DIR / 'bundle.json'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
