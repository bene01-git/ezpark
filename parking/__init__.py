"""SU Parking - a rules-based 'can I park here now?' engine for Syracuse University.

Public API:
    load_data()   -> load lots, events and permit metadata from data/
    evaluate_lot  -> evaluate one lot
    evaluate_all  -> evaluate every lot
    Status        -> availability status enum
"""

from __future__ import annotations

import json
from pathlib import Path

from .rules import Evaluation, Status, evaluate_all, evaluate_lot

__all__ = [
    "Evaluation",
    "Status",
    "evaluate_all",
    "evaluate_lot",
    "load_data",
    "DATA_DIR",
]

# data/ lives next to the package root (one level up from this file).
DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _read_json(name: str) -> dict | list:
    with open(DATA_DIR / name, encoding="utf-8") as handle:
        return json.load(handle)


def load_data(data_dir: Path | None = None) -> dict:
    """Load lots, events and permit metadata.

    Returns a dict with keys ``lots``, ``events`` and ``permits``.
    Pass ``data_dir`` to load from a different location (used in tests).
    """
    global DATA_DIR
    if data_dir is not None:
        DATA_DIR = Path(data_dir)

    lots_doc = _read_json("lots.json")
    events_doc = _read_json("events.json")
    return {
        "lots": lots_doc["lots"],
        "permits": lots_doc["permits"],
        "events": events_doc["events"],
    }
