"""Scrape the current 'SOLD OUT' permit list from SU Parking Services.

Parking and Transportation Services publishes which permit lots are sold out on
the student permit page. This flags those lots in the app (a permit lot being
sold out for the season is different from it being closed to you right now).

Be a good citizen: run this at most daily (the GitHub Action does). If the page
markup changes, the matcher below may need updating; it fails soft, writing an
empty list rather than crashing the build.

    python scripts/scrape_soldout.py
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path

import requests

try:
    from bs4 import BeautifulSoup
except ImportError:  # keep the pipeline resilient if bs4 is missing
    BeautifulSoup = None

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OUT_PATH = DATA_DIR / "sold_out.json"
SOURCE_URL = "https://parking.syr.edu/permits/student-parking-application/"

# Known lot names to look for in the sold-out sentence. Matching against a known
# vocabulary is safer than trying to parse free text.
KNOWN_LOTS = [
    "Colvin Street Lot", "Comstock Ave Lot", "Harrison St Lot", "Henry St Lot",
    "Raynor Ave Lot", "Standart West Lot", "Adams Street Garage",
    "Irving Ave Garage", "University Ave Garage", "Lawrinson Garage",
    "College Place Lot", "Skytop Lot",
]


def extract_sold_out(html: str) -> list[str]:
    text = html
    if BeautifulSoup is not None:
        text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)

    # Look at the sentence(s) that mention "SOLD OUT".
    found: list[str] = []
    for match in re.finditer(r"SOLD OUT(.{0,400})", text, flags=re.IGNORECASE):
        window = match.group(1)
        for lot in KNOWN_LOTS:
            if lot.lower() in window.lower() and lot not in found:
                found.append(lot)
    return found


def main() -> int:
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": SOURCE_URL,
        "sold_out": [],
    }
    try:
        response = requests.get(
            SOURCE_URL,
            timeout=30,
            headers={"User-Agent": "su-parking-app/1.0 (github pages project)"},
        )
        response.raise_for_status()
        payload["sold_out"] = extract_sold_out(response.text)
    except requests.RequestException as exc:
        print(f"Scrape failed (writing empty list): {exc}", file=sys.stderr)

    DATA_DIR.mkdir(exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    print(f"Wrote {len(payload['sold_out'])} sold-out lots to {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
