"""Fetch parking features near Syracuse University from OpenStreetMap.

Queries the Overpass API for ``amenity=parking`` within a bounding box around
campus and writes them as GeoJSON to ``data/osm_parking.geojson``. Run this
periodically (it changes rarely) - the GitHub Action does it weekly.

Requires network access, so it runs in CI / locally, not inside a static host.

    python scripts/fetch_osm.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OUT_PATH = DATA_DIR / "osm_parking.geojson"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Bounding box around Syracuse University main + south campus:
# (south, west, north, east)
BBOX = (43.018, -76.150, 43.048, -76.118)

QUERY = f"""
[out:json][timeout:60];
(
  node["amenity"="parking"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  way["amenity"="parking"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  relation["amenity"="parking"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
out body geom;
"""


def _element_to_feature(element: dict) -> dict | None:
    tags = element.get("tags", {})
    props = {
        "osm_id": f"{element['type']}/{element['id']}",
        "name": tags.get("name"),
        "access": tags.get("access"),
        "parking": tags.get("parking"),
        "capacity": tags.get("capacity"),
        "fee": tags.get("fee"),
    }

    if element["type"] == "node":
        geometry = {
            "type": "Point",
            "coordinates": [element["lon"], element["lat"]],
        }
    elif element["type"] == "way" and "geometry" in element:
        coords = [[pt["lon"], pt["lat"]] for pt in element["geometry"]]
        if len(coords) >= 4 and coords[0] == coords[-1]:
            geometry = {"type": "Polygon", "coordinates": [coords]}
        else:
            geometry = {"type": "LineString", "coordinates": coords}
    else:
        return None

    return {"type": "Feature", "properties": props, "geometry": geometry}


def fetch() -> dict:
    response = requests.post(OVERPASS_URL, data={"data": QUERY}, timeout=90)
    response.raise_for_status()
    elements = response.json().get("elements", [])
    features = [
        feature
        for element in elements
        if (feature := _element_to_feature(element)) is not None
    ]
    return {"type": "FeatureCollection", "features": features}


def main() -> int:
    try:
        collection = fetch()
    except requests.RequestException as exc:
        print(f"Overpass request failed: {exc}", file=sys.stderr)
        return 1

    DATA_DIR.mkdir(exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as handle:
        json.dump(collection, handle, indent=2)
    print(f"Wrote {len(collection['features'])} features to {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
