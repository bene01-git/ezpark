"""Command-line interface for the SU parking engine.

Examples:
    # What's open to a commuter right now?
    python -m parking.cli now --permit commuter

    # Check a specific lot at a specific time
    python -m parking.cli check --permit resident_grad \\
        --lot college_place_lot --at 2026-09-05T13:00

    # List the permit types and lot ids
    python -m parking.cli lots
"""

from __future__ import annotations

import argparse
from datetime import datetime

from . import load_data
from .rules import Status, evaluate_all, evaluate_lot

_ICON = {
    Status.OPEN: "[OPEN]",
    Status.PERMIT_ONLY: "[PERMIT]",
    Status.RESTRICTED: "[EVENT]",
    Status.CLOSED: "[CLOSED]",
}


def _moment(value: str | None) -> datetime:
    return datetime.now() if not value else datetime.fromisoformat(value)


def _cmd_now(args: argparse.Namespace) -> int:
    data = load_data()
    moment = _moment(args.at)
    results = evaluate_all(data["lots"], args.permit, moment, data["events"])
    results.sort(key=lambda e: (e.status is not Status.OPEN, e.lot_name))
    print(f"Parking for '{args.permit}' at {moment:%a %b %d %-I:%M %p}\n")
    for evaluation in results:
        print(f"  {_ICON[evaluation.status]:<9} {evaluation.lot_name}")
        print(f"            {evaluation.reason}")
    return 0


def _cmd_check(args: argparse.Namespace) -> int:
    data = load_data()
    lot = next((l for l in data["lots"] if l["id"] == args.lot), None)
    if lot is None:
        print(f"Unknown lot id: {args.lot}. Try 'python -m parking.cli lots'.")
        return 1
    moment = _moment(args.at)
    result = evaluate_lot(lot, args.permit, moment, data["events"])
    print(f"{result.lot_name} @ {moment:%a %b %d %-I:%M %p}")
    print(f"  {_ICON[result.status]} {result.status.label}")
    print(f"  {result.reason}")
    return 0


def _cmd_lots(_: argparse.Namespace) -> int:
    data = load_data()
    print("Permit types:")
    for permit in data["permits"]:
        print(f"  {permit['id']:<20} {permit['label']}")
    print("\nLots:")
    for lot in data["lots"]:
        print(f"  {lot['id']:<28} {lot['name']} ({lot['type']})")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="parking",
        description="Can I park at Syracuse University right now?",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    now = sub.add_parser("now", help="List every lot's status right now")
    now.add_argument("--permit", default="commuter", help="Permit type id")
    now.add_argument("--at", help="ISO datetime override, e.g. 2026-09-05T13:00")
    now.set_defaults(func=_cmd_now)

    check = sub.add_parser("check", help="Check one lot")
    check.add_argument("--permit", default="commuter", help="Permit type id")
    check.add_argument("--lot", required=True, help="Lot id")
    check.add_argument("--at", help="ISO datetime override")
    check.set_defaults(func=_cmd_check)

    lots = sub.add_parser("lots", help="List permit types and lot ids")
    lots.set_defaults(func=_cmd_lots)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
