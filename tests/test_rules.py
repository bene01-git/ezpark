"""Tests for the parking rules engine."""

from datetime import datetime

import pytest

from parking import load_data
from parking.rules import Status, evaluate_lot

# A weekday afternoon before 4:30, a weekday evening after 4:30, a weekend.
WEEKDAY_MORNING = datetime(2026, 9, 9, 10, 0)   # Wednesday 10:00
WEEKDAY_EVENING = datetime(2026, 9, 9, 17, 0)   # Wednesday 17:00
WEEKEND = datetime(2026, 9, 12, 13, 0)          # Saturday 13:00
DOME_EVENT = datetime(2026, 9, 5, 13, 0)        # Saturday during NH game


@pytest.fixture(scope="module")
def data():
    return load_data()


def _lot(data, lot_id):
    return next(l for l in data["lots"] if l["id"] == lot_id)


def test_orange_lot_closed_to_visitor(data):
    lot = _lot(data, "college_place_lot")
    result = evaluate_lot(lot, "visitor", WEEKDAY_MORNING, data["events"])
    assert result.status is Status.PERMIT_ONLY


def test_orange_lot_permit_before_430(data):
    lot = _lot(data, "college_place_lot")
    result = evaluate_lot(lot, "commuter", WEEKDAY_MORNING, data["events"])
    assert result.status is Status.PERMIT_ONLY


def test_orange_lot_open_after_430_weekday(data):
    lot = _lot(data, "college_place_lot")
    result = evaluate_lot(lot, "commuter", WEEKDAY_EVENING, data["events"])
    assert result.status is Status.OPEN


def test_orange_lot_open_on_weekend(data):
    lot = _lot(data, "raynor_ave_lot")
    result = evaluate_lot(lot, "commuter", WEEKEND, data["events"])
    assert result.status is Status.OPEN


def test_public_garage_open_to_visitor(data):
    lot = _lot(data, "university_ave_garage")
    result = evaluate_lot(lot, "visitor", WEEKDAY_MORNING, data["events"])
    assert result.status is Status.OPEN


def test_assigned_permit_lot_open(data):
    lot = _lot(data, "harrison_lot")
    result = evaluate_lot(lot, "commuter", WEEKDAY_MORNING, data["events"])
    assert result.status is Status.OPEN


def test_permit_lot_closed_to_wrong_permit(data):
    lot = _lot(data, "irving_ave_garage")
    result = evaluate_lot(lot, "commuter", WEEKDAY_MORNING, data["events"])
    assert result.status is Status.PERMIT_ONLY


def test_dome_event_restricts_lot(data):
    lot = _lot(data, "college_place_lot")
    # College Place is dome_restricted; during the NH game it should be blocked
    # even though it's a Saturday (when Orange rules would otherwise open it).
    result = evaluate_lot(lot, "commuter", DOME_EVENT, data["events"])
    assert result.status is Status.RESTRICTED


def test_non_restricted_lot_unaffected_by_event(data):
    lot = _lot(data, "skytop_lot")
    result = evaluate_lot(lot, "commuter", DOME_EVENT, data["events"])
    assert result.status is Status.OPEN


def test_downtown_private_garage_open_to_visitor(data):
    lot = _lot(data, "franklin_st_garage")
    result = evaluate_lot(lot, "visitor", WEEKDAY_MORNING, data["events"])
    assert result.status is Status.OPEN


def test_downtown_lots_are_non_su(data):
    downtown = [l for l in data["lots"] if l["owner"] != "su"]
    assert len(downtown) >= 4  # street + several garages


def test_street_parking_open(data):
    lot = _lot(data, "marshall_st_street")
    result = evaluate_lot(lot, "visitor", WEEKDAY_MORNING, data["events"])
    assert result.status is Status.OPEN
