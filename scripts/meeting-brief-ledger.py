#!/usr/bin/env python3
"""
meeting-brief-ledger: Manage per-event meeting brief state and file paths.

A single source of truth for:
  - File path / slug convention for per-meeting brief markdown
  - Ledger of which calendar events have been briefed (status, refresh count)
  - Filtering of "high-stakes" events worth a just-in-time brief

The ledger lives at assistant/state/meeting-briefs.json. It's intentionally
small: status only, never the brief content. Brief content is the markdown
file at the path returned by `path-for`.

Subcommands:
  slug TITLE                          -> sanitized slug
  path-for EVENT_ID --start ISO --title TITLE [--root REPO]
                                      -> absolute path for the brief file
  claim EVENT_ID --start ISO --title TITLE [--external N]
                                      -> register PENDING; exits non-zero if
                                         already claimed (dedupe primitive)
  mark EVENT_ID --status STATUS [--file PATH] [--recap-file PATH]
                                        [--recap-summary TEXT]
                                      -> set status (sent|skipped|failed|refreshed|
                                         recapped|recap-failed)
                                         increments refresh_count if STATUS=refreshed
  is-briefed EVENT_ID                 -> exits 0 if SENT/REFRESHED, 1 otherwise
  is-recapped EVENT_ID                -> exits 0 if RECAPPED, 1 otherwise
  pending --within-min N --json       -> read events from stdin (JSON array of
                                         {event_id,title,start,end,attendees,
                                         external_count}), emit those that are
                                         high-stakes, start within N min, and
                                         not yet briefed
  recap-pending                       -> read events from stdin, emit those that
                                         ended today, not yet recapped, and
                                         ended <= 60 min ago (recap window)
  list [--date YYYY-MM-DD]            -> dump ledger entries for a date

High-stakes rule (overridable via env MEETING_BRIEF_RULES):
  - >=1 external attendee, OR
  - title matches /1:?1|sync|review|decision|interview|meeting/i AND duration >= 25 min

Designed to be called from shell automation and from the /meeting-brief prompt.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]  # personal/
LEDGER_PATH = REPO_ROOT / "assistant/state/meeting-briefs.json"
BRIEFS_ROOT = REPO_ROOT / "assistant/briefings/meetings"

VALID_STATUSES = {"pending", "sent", "skipped", "failed", "refreshed",
                  "recapped", "recap-failed"}
RECAPS_ROOT = REPO_ROOT / "assistant/meetings"
HIGH_STAKES_TITLE_RE = re.compile(
    r"\b(1:?1|sync|review|decision|interview|leadership|debrief|prep|kickoff)\b",
    re.IGNORECASE,
)
DEFAULT_HIGH_STAKES_MIN_DURATION_MIN = 25


# ----- ledger I/O -------------------------------------------------------------

def load_ledger() -> dict:
    if not LEDGER_PATH.exists():
        return {"version": 1, "events": {}}
    try:
        return json.loads(LEDGER_PATH.read_text())
    except json.JSONDecodeError:
        # Corrupt ledger: back up and start fresh rather than erase silently.
        backup = LEDGER_PATH.with_suffix(".corrupt.json")
        LEDGER_PATH.rename(backup)
        return {"version": 1, "events": {}}


def save_ledger(ledger: dict) -> None:
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = LEDGER_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(ledger, indent=2, sort_keys=True))
    tmp.replace(LEDGER_PATH)


# ----- slug + path ------------------------------------------------------------

SLUG_KEEP_RE = re.compile(r"[^a-z0-9]+")


def slugify(title: str, max_len: int = 40) -> str:
    s = SLUG_KEEP_RE.sub("-", (title or "untitled").lower()).strip("-")
    if not s:
        s = "untitled"
    return s[:max_len].rstrip("-")


def parse_iso(s: str) -> datetime:
    """Accept either a Z-suffixed or naive ISO timestamp."""
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def path_for(event_id: str, start_iso: str, title: str) -> Path:
    """Stable per-event path. Same event id -> same path even if rerun."""
    start = parse_iso(start_iso).astimezone()
    date_dir = BRIEFS_ROOT / start.strftime("%Y-%m-%d")
    fname = f"{start.strftime('%H%M')}-{slugify(title)}.md"
    return date_dir / fname


def recap_path_for(event_id: str, start_iso: str, title: str) -> Path:
    """Stable per-event recap path under assistant/meetings/YYYY/MM/."""
    start = parse_iso(start_iso).astimezone()
    date_dir = RECAPS_ROOT / start.strftime("%Y/%m")
    fname = f"{start.strftime('%Y-%m-%d')}_{slugify(title)}.md"
    return date_dir / fname


# ----- high-stakes filter -----------------------------------------------------

def duration_minutes(event: dict) -> int:
    if "end" not in event or "start" not in event:
        return 0
    try:
        return int((parse_iso(event["end"]) - parse_iso(event["start"])).total_seconds() // 60)
    except Exception:
        return 0


def is_high_stakes(event: dict) -> bool:
    """Heuristic for which upcoming meetings warrant a JIT brief."""
    if int(event.get("external_count", 0)) >= 1:
        return True
    title = event.get("title", "")
    dur = duration_minutes(event)
    if HIGH_STAKES_TITLE_RE.search(title) and dur >= DEFAULT_HIGH_STAKES_MIN_DURATION_MIN:
        return True
    return False


# ----- subcommands ------------------------------------------------------------

def cmd_slug(args) -> int:
    print(slugify(args.title))
    return 0


def cmd_path(args) -> int:
    p = path_for(args.event_id, args.start, args.title)
    print(p)
    return 0


def cmd_claim(args) -> int:
    ledger = load_ledger()
    if args.event_id in ledger["events"] and not args.force:
        # Already claimed; non-zero exit signals "skip" to the sweep.
        existing = ledger["events"][args.event_id]
        sys.stderr.write(
            f"already claimed: status={existing.get('status')} "
            f"file={existing.get('file', '?')}\n"
        )
        return 1
    p = path_for(args.event_id, args.start, args.title)
    ledger["events"][args.event_id] = {
        "event_id": args.event_id,
        "title": args.title,
        "start": args.start,
        "external_count": args.external,
        "status": "pending",
        "file": str(p),
        "claimed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "refresh_count": 0,
    }
    save_ledger(ledger)
    print(p)
    return 0


def cmd_mark(args) -> int:
    if args.status not in VALID_STATUSES:
        sys.stderr.write(f"invalid status: {args.status}\n")
        return 2
    ledger = load_ledger()
    entry = ledger["events"].get(args.event_id)
    if not entry:
        sys.stderr.write(f"unknown event: {args.event_id} (claim first)\n")
        return 1
    entry["status"] = args.status
    entry["last_status_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if args.file:
        entry["file"] = args.file
    if args.recap_file:
        entry["recap_file"] = args.recap_file
    if args.recap_summary:
        entry["recap_summary"] = args.recap_summary
    if args.status == "refreshed":
        entry["refresh_count"] = int(entry.get("refresh_count", 0)) + 1
    save_ledger(ledger)
    return 0


def cmd_is_briefed(args) -> int:
    ledger = load_ledger()
    entry = ledger["events"].get(args.event_id)
    if entry and entry.get("status") in {"sent", "refreshed", "recapped"}:
        return 0
    return 1


def cmd_is_recapped(args) -> int:
    ledger = load_ledger()
    entry = ledger["events"].get(args.event_id)
    if entry and entry.get("status") == "recapped":
        return 0
    return 1


def cmd_pending(args) -> int:
    """Filter a piped JSON event list for 'needs briefing now'."""
    raw = sys.stdin.read().strip()
    if not raw:
        sys.stderr.write("no event JSON on stdin\n")
        return 2
    try:
        events = json.loads(raw)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"invalid JSON on stdin: {e}\n")
        return 2

    cutoff = datetime.now(timezone.utc) + timedelta(minutes=args.within_min)
    ledger = load_ledger()
    out = []
    for ev in events:
        if not all(k in ev for k in ("event_id", "title", "start")):
            continue
        try:
            start = parse_iso(ev["start"]).astimezone(timezone.utc)
        except Exception:
            continue
        if start > cutoff:
            continue
        if start < datetime.now(timezone.utc) - timedelta(minutes=5):
            # Already started or in the past: skip.
            continue
        existing = ledger["events"].get(ev["event_id"])
        if existing and existing.get("status") in {"sent", "refreshed"} and not args.refresh:
            continue
        if not is_high_stakes(ev):
            continue
        out.append(ev)

    print(json.dumps(out, indent=2))
    return 0


def cmd_recap_pending(args) -> int:
    """Filter piped JSON event list for 'ended today, not yet recapped, within recap window'."""
    raw = sys.stdin.read().strip()
    if not raw:
        sys.stderr.write("no event JSON on stdin\n")
        return 2
    try:
        events = json.loads(raw)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"invalid JSON on stdin: {e}\n")
        return 2

    now = datetime.now(timezone.utc)
    today_str = now.astimezone().strftime("%Y-%m-%d")
    max_age = timedelta(minutes=args.max_age_min)
    ledger = load_ledger()
    out = []
    for ev in events:
        if not all(k in ev for k in ("event_id", "title", "end")):
            continue
        try:
            end = parse_iso(ev["end"]).astimezone(timezone.utc)
        except Exception:
            continue
        # Must have ended today
        if end.astimezone().strftime("%Y-%m-%d") != today_str:
            continue
        # Must have already ended
        if end > now:
            continue
        # Must be within the recap window (default: ended <= 60 min ago)
        if (now - end) > max_age:
            continue
        # Skip if already recapped
        existing = ledger["events"].get(ev["event_id"])
        if existing and existing.get("status") == "recapped":
            continue
        out.append(ev)

    print(json.dumps(out, indent=2))
    return 0


def cmd_list(args) -> int:
    ledger = load_ledger()
    rows = list(ledger.get("events", {}).values())
    if args.date:
        rows = [r for r in rows if (r.get("start") or "").startswith(args.date)]
    rows.sort(key=lambda r: r.get("start", ""))
    print(json.dumps(rows, indent=2))
    return 0


# ----- argparse ---------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1] if __doc__ else "")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("slug", help="Sanitize a title to a slug")
    s.add_argument("title")
    s.set_defaults(func=cmd_slug)

    s = sub.add_parser("path-for", help="Compute the brief file path")
    s.add_argument("event_id")
    s.add_argument("--start", required=True, help="ISO start time")
    s.add_argument("--title", required=True)
    s.set_defaults(func=cmd_path)

    s = sub.add_parser("claim", help="Register PENDING; non-zero if already claimed")
    s.add_argument("event_id")
    s.add_argument("--start", required=True)
    s.add_argument("--title", required=True)
    s.add_argument("--external", type=int, default=0)
    s.add_argument("--force", action="store_true",
                   help="Re-claim even if already in ledger (for refresh)")
    s.set_defaults(func=cmd_claim)

    s = sub.add_parser("mark", help="Update status for an event")
    s.add_argument("event_id")
    s.add_argument("--status", required=True, choices=sorted(VALID_STATUSES))
    s.add_argument("--file")
    s.add_argument("--recap-file", dest="recap_file",
                   help="Path to the recap markdown file")
    s.add_argument("--recap-summary", dest="recap_summary",
                   help="2-3 sentence digest of the meeting for EOD/weekly")
    s.set_defaults(func=cmd_mark)

    s = sub.add_parser("is-briefed", help="Exit 0 if event has a sent/refreshed brief")
    s.add_argument("event_id")
    s.set_defaults(func=cmd_is_briefed)

    s = sub.add_parser("is-recapped", help="Exit 0 if event has been recapped")
    s.add_argument("event_id")
    s.set_defaults(func=cmd_is_recapped)

    s = sub.add_parser("pending", help="Filter piped event JSON for needs-briefing-now")
    s.add_argument("--within-min", type=int, default=60)
    s.add_argument("--refresh", action="store_true",
                   help="Include events already briefed (for explicit refresh sweeps)")
    s.set_defaults(func=cmd_pending)

    s = sub.add_parser("recap-pending",
                       help="Filter piped event JSON for needs-recap-now")
    s.add_argument("--max-age-min", type=int, default=60,
                   help="Max minutes since meeting ended (default 60)")
    s.set_defaults(func=cmd_recap_pending)

    s = sub.add_parser("list", help="Dump ledger entries")
    s.add_argument("--date", help="Filter by YYYY-MM-DD")
    s.set_defaults(func=cmd_list)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
