"""Availability rules engine for Syracuse University parking.

This module answers one question: *given a permit type and a moment in time,
can a person park in a given lot?*

There is NO public real-time occupancy feed for SU parking, so this does not
report live open spaces. Instead it evaluates the university's published
**access rules** (permit eligibility, the "Orange lot after 4:30 p.m." rule,
Dome/event restrictions, winter odd/even street parking) to tell you whether a
lot is *open to you right now*.

The rules for each lot live in ``data/lots.json`` as plain data, so the same
logic can be mirrored trivially in the browser (see ``site/app.js``). Keeping
the rules declarative is deliberate: the policy lives in one place and both the
Python CLI/tests and the JavaScript map read from it.

IMPORTANT: the encoded rules are a simplified model of official policy and can
go out of date. Always confirm against Parking and Transportation Services
(https://parking.syr.edu) before relying on a result.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time
from enum import Enum
from typing import Iterable


class Status(str, Enum):
    """The result of evaluating a lot for a given permit and time."""

    OPEN = "open"                # you may park here now
    PERMIT_ONLY = "permit_only"  # requires a permit you don't hold
    RESTRICTED = "restricted"    # temporarily closed to you (e.g. Dome event)
    CLOSED = "closed"            # not available to this permit type at all

    @property
    def label(self) -> str:
        return {
            Status.OPEN: "Open to you now",
            Status.PERMIT_ONLY: "Permit required",
            Status.RESTRICTED: "Restricted right now",
            Status.CLOSED: "Not available to you",
        }[self]


@dataclass(frozen=True)
class Evaluation:
    """A single lot's evaluated status plus a human-readable reason."""

    lot_id: str
    lot_name: str
    status: Status
    reason: str

    def as_dict(self) -> dict:
        return {
            "lot_id": self.lot_id,
            "lot_name": self.lot_name,
            "status": self.status.value,
            "status_label": self.status.label,
            "reason": self.reason,
        }


def _parse_hhmm(value: str) -> time:
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


def _is_weekend(moment: datetime) -> bool:
    # Monday is 0, Sunday is 6.
    return moment.weekday() >= 5


def _dome_event_active(moment: datetime, events: Iterable[dict]) -> dict | None:
    """Return the first event whose restriction window contains ``moment``."""
    for event in events:
        start = datetime.fromisoformat(event["restriction_start"])
        end = datetime.fromisoformat(event["restriction_end"])
        if start <= moment <= end:
            return event
    return None


def _winter_odd_even_active(moment: datetime) -> bool:
    """Syracuse winter odd/even street parking runs Nov 1 - Apr 1."""
    month = moment.month
    return month in (11, 12, 1, 2, 3)


def evaluate_lot(
    lot: dict,
    permit: str,
    moment: datetime,
    events: Iterable[dict] = (),
) -> Evaluation:
    """Evaluate a single lot for a permit type at a moment in time.

    ``permit`` is a permit id (see ``data/lots.json`` -> ``permits``) or the
    special value ``"visitor"`` for someone with no SU permit.
    """
    events = list(events)
    name = lot["name"]
    lot_id = lot["id"]

    # 1. Dome / event restrictions override normal access for affected lots.
    if lot.get("dome_restricted"):
        event = _dome_event_active(moment, events)
        if event is not None:
            return Evaluation(
                lot_id,
                name,
                Status.RESTRICTED,
                f"Closed for {event['name']} until "
                f"{datetime.fromisoformat(event['restriction_end']):%-I:%M %p}.",
            )

    # 2. Public hourly facilities (e.g. University Ave Garage) are open to all,
    #    permit or not - you pull a ticket at the gate.
    if lot.get("public_hourly"):
        return Evaluation(
            lot_id, name, Status.OPEN,
            "Open to the public for hourly parking - pull a ticket at the gate.",
        )

    # 3. If you hold a permit valid for this lot, you're in (subject to step 1).
    if permit in lot.get("permits", []):
        return Evaluation(
            lot_id, name, Status.OPEN,
            "Your permit is assigned to this lot.",
        )

    # 4. The "Orange lot" rule: any valid permit is honored in Orange lots
    #    after 4:30 p.m. on weekdays and any time on weekends (except Dome
    #    events, already handled above).
    if lot.get("category") == "orange" and permit != "visitor":
        after = _parse_hhmm(lot.get("orange_after", "16:30"))
        if _is_weekend(moment):
            return Evaluation(
                lot_id, name, Status.OPEN,
                "Orange lot - open to any valid permit on weekends.",
            )
        if moment.time() >= after:
            return Evaluation(
                lot_id, name, Status.OPEN,
                f"Orange lot - open to any valid permit after "
                f"{after:%-I:%M %p} on weekdays.",
            )
        return Evaluation(
            lot_id, name, Status.PERMIT_ONLY,
            f"Orange lot - opens to any valid permit at {after:%-I:%M %p} "
            "on weekdays.",
        )

    # 5. Metered / city street parking.
    if lot.get("category") == "street":
        note = "City street parking - pay until 6:00 p.m."
        if _winter_odd_even_active(moment):
            note += " Winter odd/even rules are in effect (Nov 1 - Apr 1)."
        return Evaluation(lot_id, name, Status.OPEN, note)

    # 6. Otherwise it needs a permit this person doesn't hold.
    return Evaluation(
        lot_id, name, Status.PERMIT_ONLY,
        "Requires an assigned permit for this lot.",
    )


def evaluate_all(
    lots: Iterable[dict],
    permit: str,
    moment: datetime,
    events: Iterable[dict] = (),
) -> list[Evaluation]:
    """Evaluate every lot and return the results in input order."""
    events = list(events)
    return [evaluate_lot(lot, permit, moment, events) for lot in lots]
