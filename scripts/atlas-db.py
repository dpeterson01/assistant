#!/usr/bin/env python3
"""
atlas-db: Unified data store for the personal assistant system.

Source of truth for commitments, meetings, and interactions.
Things 3 is a push target for mobile access.
Markdown files are generated views rendered on every write.

Usage:
  atlas-db.py init
  atlas-db.py commit add --title "..." --person "..." --direction mine [options]
  atlas-db.py commit complete --task-id AI-...
  atlas-db.py commit cancel --task-id AI-...
  atlas-db.py commit list [--direction mine|theirs] [--status active] [--person "..."]
  atlas-db.py commit overdue
  atlas-db.py commit search --query "..."
  atlas-db.py commit nudge --task-id AI-... [--channel email]
  atlas-db.py meeting add --event-id ID --title "..." --start ISO [options]
  atlas-db.py meeting recap --event-id ID --summary "..." [--recap-file PATH]
  atlas-db.py meeting mark --event-id ID --status sent|skipped|failed|refreshed
  atlas-db.py meeting list [--date YYYY-MM-DD]
  atlas-db.py meeting show --event-id ID
  atlas-db.py meeting pending --within-min N  (reads JSON from stdin)
  atlas-db.py meeting recap-pending           (reads JSON from stdin)
  atlas-db.py interaction log --person "..." --type meeting [options]
  atlas-db.py interaction last --person "..."
  atlas-db.py interaction list [--person "..."] [--type email] [--days 30]
  atlas-db.py sync-things3
  atlas-db.py render
  atlas-db.py import-markdown
  atlas-db.py import-ledger
  atlas-db.py dump
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from textwrap import dedent

# ---- paths -------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]  # personal/
DB_PATH = REPO_ROOT / "assistant" / "state" / "assistant.db"
ACTION_ITEMS_PATH = REPO_ROOT / "assistant" / "context" / "action-items.md"
WAITING_ON_PATH = REPO_ROOT / "assistant" / "context" / "waiting-on-others.md"
LEDGER_PATH = REPO_ROOT / "assistant" / "state" / "meeting-briefs.json"
THINGS3_DB = Path.home() / "Library" / "Group Containers" / \
    "JLMPQHK86H.com.culturedcode.ThingsMac" / "ThingsData-BX8ZL" / \
    "Things Database.thingsdatabase" / "main.sqlite"
THINGS3_ADD = REPO_ROOT / "assistant" / "things3" / "add.sh"
THINGS3_COMPLETE = REPO_ROOT / "assistant" / "things3" / "complete.sh"

# ---- schema ------------------------------------------------------------------

SCHEMA_VERSION = 1

SCHEMA_SQL = """\
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS commitments (
    task_id       TEXT PRIMARY KEY,
    things3_uuid  TEXT UNIQUE,
    title         TEXT NOT NULL,
    direction     TEXT NOT NULL CHECK(direction IN ('mine', 'theirs')),
    category      TEXT CHECK(category IN ('work', 'personal', 'church', 'hmbl')),
    person        TEXT,
    source        TEXT,
    channel       TEXT,
    due_date      TEXT,
    status        TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
    created_at    TEXT DEFAULT (datetime('now', 'localtime')),
    completed_at  TEXT,
    last_nudge    TEXT,
    nudge_count   INTEGER DEFAULT 0,
    notes         TEXT
);

CREATE TABLE IF NOT EXISTS meetings (
    event_id             TEXT PRIMARY KEY,
    title                TEXT NOT NULL,
    date                 TEXT,
    start_time           TEXT,
    end_time             TEXT,
    attendees            TEXT,
    external_count       INTEGER DEFAULT 0,
    category             TEXT CHECK(category IN ('work', 'personal', 'church', 'hmbl')),
    brief_status         TEXT,
    brief_file           TEXT,
    recap_status         TEXT,
    recap_file           TEXT,
    copilot_summary      TEXT,
    key_decisions        TEXT,
    action_items         TEXT,
    recap_summary        TEXT,
    recording_url        TEXT,
    transcript_available INTEGER DEFAULT 0,
    refresh_count        INTEGER DEFAULT 0,
    claimed_at           TEXT,
    created_at           TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS interactions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    person    TEXT NOT NULL,
    type      TEXT,
    direction TEXT CHECK(direction IN ('inbound', 'outbound')),
    summary   TEXT,
    source_id TEXT,
    category  TEXT CHECK(category IN ('work', 'personal', 'church', 'hmbl')),
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_commitments_direction ON commitments(direction);
CREATE INDEX IF NOT EXISTS idx_commitments_status    ON commitments(status);
CREATE INDEX IF NOT EXISTS idx_commitments_person    ON commitments(person);
CREATE INDEX IF NOT EXISTS idx_commitments_category  ON commitments(category);
CREATE INDEX IF NOT EXISTS idx_commitments_due       ON commitments(due_date);
CREATE INDEX IF NOT EXISTS idx_meetings_date         ON meetings(date);
CREATE INDEX IF NOT EXISTS idx_interactions_person    ON interactions(person);
CREATE INDEX IF NOT EXISTS idx_interactions_timestamp ON interactions(timestamp);
"""

# ---- db helpers --------------------------------------------------------------

def get_db(readonly: bool = False) -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if readonly:
        uri = f"file:{DB_PATH}?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
    else:
        conn = sqlite3.connect(str(DB_PATH))
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
    row = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
    if not row:
        conn.execute("INSERT INTO meta (key, value) VALUES ('schema_version', ?)",
                      (str(SCHEMA_VERSION),))
        conn.commit()


def generate_task_id() -> str:
    return "AI-" + datetime.now().strftime("%Y%m%d-%H%M%S")


# ---- rendering --------------------------------------------------------------

def render_action_items(conn: sqlite3.Connection) -> None:
    """Generate action-items.md from commitments WHERE direction='mine'."""
    active = conn.execute(
        "SELECT * FROM commitments WHERE direction='mine' AND status='active' "
        "ORDER BY due_date IS NULL, due_date, created_at"
    ).fetchall()
    completed = conn.execute(
        "SELECT * FROM commitments WHERE direction='mine' AND status='completed' "
        "AND completed_at >= date('now', '-7 days', 'localtime') "
        "ORDER BY completed_at DESC"
    ).fetchall()

    lines = [
        "# Action Items (Mine)\n",
        "Things Derek owes others. Synced to Things 3.\n",
        f"Updated: {datetime.now().strftime('%Y-%m-%d')}\n",
        "## Active\n",
    ]
    for r in active:
        t3 = "yes" if r["things3_uuid"] else "no"
        parts = [f"- [ ] {r['title']}"]
        if r["person"]:
            parts.append(f"Owed to: {r['person']}")
        if r["source"]:
            parts.append(f"Source: {r['source']}")
        if r["due_date"]:
            due_str = r["due_date"]
            if due_str != "ASAP":
                try:
                    due_dt = datetime.strptime(due_str, "%Y-%m-%d").date()
                    delta = (due_dt - datetime.now().date()).days
                    if delta < 0:
                        due_str += f" ({abs(delta)} days, OVERDUE)"
                    elif delta <= 3:
                        due_str += f" ({delta} days)"
                except ValueError:
                    pass
            parts.append(f"Due: {due_str}")
        parts.append(f"Things3: {t3}")
        if r["task_id"]:
            parts.append(f"Task ID: {r['task_id']}")
        lines.append(" | ".join(parts))

    lines.append("\n## Completed (last 7 days, auto-pruned)")
    for r in completed:
        lines.append(f"- [x] {r['title']} | Completed: {r['completed_at'][:10]}")

    ACTION_ITEMS_PATH.parent.mkdir(parents=True, exist_ok=True)
    ACTION_ITEMS_PATH.write_text("\n".join(lines) + "\n")


def render_waiting_on(conn: sqlite3.Connection) -> None:
    """Generate waiting-on-others.md from commitments WHERE direction='theirs'."""
    active = conn.execute(
        "SELECT * FROM commitments WHERE direction='theirs' AND status='active' "
        "ORDER BY due_date IS NULL, due_date, created_at"
    ).fetchall()
    completed = conn.execute(
        "SELECT * FROM commitments WHERE direction='theirs' AND status='completed' "
        "AND completed_at >= date('now', '-14 days', 'localtime') "
        "ORDER BY completed_at DESC"
    ).fetchall()

    lines = [
        "# Waiting On Others\n",
        "Commitments others have made to Derek. Nudgeable via nudge agent.\n",
        f"Updated: {datetime.now().strftime('%Y-%m-%d')}\n",
        "## Active\n",
    ]
    for r in active:
        parts = [f"- [ ] **{r['person'] or 'Unknown'}**"]
        parts.append(r["title"])
        if r["due_date"]:
            due_str = r["due_date"]
            if due_str != "ASAP" and due_str:
                try:
                    due_dt = datetime.strptime(due_str, "%Y-%m-%d").date()
                    delta = (due_dt - datetime.now().date()).days
                    if delta < 0:
                        due_str += f" ({abs(delta)} days overdue)"
                except ValueError:
                    pass
            parts.append(f"Due: {due_str}")
        nudge = r["last_nudge"] or "never"
        parts.append(f"Last nudge: {nudge}")
        if r["channel"]:
            parts.append(f"Channel: {r['channel']}")
        if r["notes"]:
            parts.append(f"Status: {r['notes']}")
        lines.append(" | ".join(parts))

    lines.append("\n## Resolved (last 14 days)")
    for r in completed:
        lines.append(f"- [x] **{r['person'] or 'Unknown'}** | {r['title']} | Resolved: {r['completed_at'][:10]}")

    WAITING_ON_PATH.parent.mkdir(parents=True, exist_ok=True)
    WAITING_ON_PATH.write_text("\n".join(lines) + "\n")


def do_render(conn: sqlite3.Connection) -> None:
    render_action_items(conn)
    render_waiting_on(conn)


# ---- commitment subcommands -------------------------------------------------

def cmd_commit_add(args) -> int:
    conn = get_db()
    ensure_schema(conn)
    task_id = args.task_id or generate_task_id()

    # Check for duplicate
    existing = conn.execute("SELECT task_id FROM commitments WHERE task_id=?",
                            (task_id,)).fetchone()
    if existing:
        sys.stderr.write(f"task_id already exists: {task_id}\n")
        return 1

    conn.execute(
        "INSERT INTO commitments (task_id, title, direction, category, person, "
        "source, channel, due_date, notes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (task_id, args.title, args.direction, args.category, args.person,
         args.source, args.channel, args.due, args.notes)
    )
    conn.commit()

    # Push to Things 3
    things3_uuid = None
    if not args.no_push and THINGS3_ADD.exists():
        things3_uuid = push_to_things3(
            title=args.title, task_id=task_id, direction=args.direction,
            person=args.person, due=args.due, category=args.category,
            notes=args.notes
        )
        if things3_uuid:
            conn.execute("UPDATE commitments SET things3_uuid=? WHERE task_id=?",
                         (things3_uuid, task_id))
            conn.commit()

    if not args.no_render:
        do_render(conn)

    print(json.dumps({"task_id": task_id, "things3_uuid": things3_uuid}))
    conn.close()
    return 0


def complete_in_things3(task_id: str, things3_uuid: str | None) -> None:
    """Push a completion to Things 3 via complete.sh."""
    if not THINGS3_COMPLETE.exists():
        return
    try:
        if things3_uuid:
            subprocess.run([str(THINGS3_COMPLETE), things3_uuid],
                           capture_output=True, text=True, timeout=10)
        else:
            subprocess.run([str(THINGS3_COMPLETE), "--task-id", task_id],
                           capture_output=True, text=True, timeout=10)
    except Exception as e:
        sys.stderr.write(f"things3 complete failed: {e}\n")


def cmd_commit_complete(args) -> int:
    conn = get_db()
    ensure_schema(conn)

    # Get things3_uuid before updating
    row = conn.execute(
        "SELECT things3_uuid FROM commitments WHERE task_id=? AND status='active'",
        (args.task_id,)
    ).fetchone()
    if not row:
        sys.stderr.write(f"no active commitment: {args.task_id}\n")
        conn.close()
        return 1

    now = datetime.now().strftime("%Y-%m-%d")
    conn.execute(
        "UPDATE commitments SET status='completed', completed_at=? "
        "WHERE task_id=? AND status='active'", (now, args.task_id)
    )
    conn.commit()

    # Push completion to Things 3
    if not getattr(args, 'no_push', False):
        complete_in_things3(args.task_id, row["things3_uuid"])

    if not args.no_render:
        do_render(conn)
    print(f"completed: {args.task_id}")
    conn.close()
    return 0


def cmd_commit_cancel(args) -> int:
    conn = get_db()
    ensure_schema(conn)
    now = datetime.now().strftime("%Y-%m-%d")
    result = conn.execute(
        "UPDATE commitments SET status='cancelled', completed_at=? "
        "WHERE task_id=? AND status='active'", (now, args.task_id)
    )
    if result.rowcount == 0:
        sys.stderr.write(f"no active commitment: {args.task_id}\n")
        conn.close()
        return 1
    conn.commit()
    if not args.no_render:
        do_render(conn)
    print(f"cancelled: {args.task_id}")
    conn.close()
    return 0


def cmd_commit_list(args) -> int:
    conn = get_db(readonly=True)
    ensure_schema(conn)
    sql = "SELECT * FROM commitments WHERE 1=1"
    params: list = []
    if args.direction:
        sql += " AND direction=?"
        params.append(args.direction)
    if args.status:
        sql += " AND status=?"
        params.append(args.status)
    if args.person:
        sql += " AND person LIKE ?"
        params.append(f"%{args.person}%")
    if args.category:
        sql += " AND category=?"
        params.append(args.category)
    sql += " ORDER BY due_date IS NULL, due_date, created_at"
    rows = conn.execute(sql, params).fetchall()
    print(json.dumps([dict(r) for r in rows], indent=2))
    conn.close()
    return 0


def cmd_commit_overdue(args) -> int:
    conn = get_db(readonly=True)
    ensure_schema(conn)
    today = datetime.now().strftime("%Y-%m-%d")
    rows = conn.execute(
        "SELECT * FROM commitments WHERE status='active' "
        "AND due_date IS NOT NULL AND due_date != 'ASAP' AND due_date < ? "
        "ORDER BY due_date, direction", (today,)
    ).fetchall()
    print(json.dumps([dict(r) for r in rows], indent=2))
    conn.close()
    return 0


def cmd_commit_search(args) -> int:
    conn = get_db(readonly=True)
    ensure_schema(conn)
    rows = conn.execute(
        "SELECT * FROM commitments WHERE title LIKE ? OR person LIKE ? OR notes LIKE ?",
        (f"%{args.query}%", f"%{args.query}%", f"%{args.query}%")
    ).fetchall()
    print(json.dumps([dict(r) for r in rows], indent=2))
    conn.close()
    return 0


def cmd_commit_nudge(args) -> int:
    conn = get_db()
    ensure_schema(conn)
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    result = conn.execute(
        "UPDATE commitments SET last_nudge=?, nudge_count=nudge_count+1 "
        "WHERE task_id=? AND status='active'", (now, args.task_id)
    )
    if result.rowcount == 0:
        sys.stderr.write(f"no active commitment: {args.task_id}\n")
        conn.close()
        return 1
    if args.channel:
        conn.execute("UPDATE commitments SET channel=? WHERE task_id=?",
                      (args.channel, args.task_id))
    conn.commit()
    if not args.no_render:
        do_render(conn)
    print(f"nudged: {args.task_id}")
    conn.close()
    return 0


# ---- meeting subcommands ----------------------------------------------------

HIGH_STAKES_RE = re.compile(
    r"\b(1:?1|sync|review|decision|interview|leadership|debrief|prep|kickoff)\b",
    re.IGNORECASE,
)


def parse_iso(s: str) -> datetime:
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def cmd_meeting_add(args) -> int:
    conn = get_db()
    ensure_schema(conn)
    start = parse_iso(args.start)
    date_str = start.astimezone().strftime("%Y-%m-%d")

    conn.execute(
        "INSERT OR REPLACE INTO meetings "
        "(event_id, title, date, start_time, end_time, attendees, "
        "external_count, category, brief_status, claimed_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now','localtime'))",
        (args.event_id, args.title, date_str, args.start,
         args.end, args.attendees, args.external or 0, args.category)
    )
    conn.commit()
    print(json.dumps({"event_id": args.event_id, "date": date_str}))
    conn.close()
    return 0


def cmd_meeting_mark(args) -> int:
    conn = get_db()
    ensure_schema(conn)
    valid = {"pending", "sent", "skipped", "failed", "refreshed"}
    if args.status not in valid:
        sys.stderr.write(f"invalid brief_status: {args.status} (valid: {valid})\n")
        return 2

    row = conn.execute("SELECT event_id, refresh_count FROM meetings WHERE event_id=?",
                        (args.event_id,)).fetchone()
    if not row:
        sys.stderr.write(f"unknown event: {args.event_id}\n")
        return 1

    updates = ["brief_status=?"]
    params: list = [args.status]
    if args.file:
        updates.append("brief_file=?")
        params.append(args.file)
    if args.status == "refreshed":
        updates.append("refresh_count=refresh_count+1")

    params.append(args.event_id)
    conn.execute(f"UPDATE meetings SET {', '.join(updates)} WHERE event_id=?", params)
    conn.commit()
    conn.close()
    return 0


def cmd_meeting_recap(args) -> int:
    conn = get_db()
    ensure_schema(conn)

    # Upsert: create meeting row if it doesn't exist
    existing = conn.execute("SELECT event_id FROM meetings WHERE event_id=?",
                             (args.event_id,)).fetchone()
    if not existing:
        conn.execute(
            "INSERT INTO meetings (event_id, title, recap_status) VALUES (?, ?, 'recapped')",
            (args.event_id, args.title or "Unknown meeting")
        )

    updates = ["recap_status='recapped'"]
    params: list = []
    if args.summary:
        updates.append("recap_summary=?")
        params.append(args.summary)
    if args.copilot_summary:
        updates.append("copilot_summary=?")
        params.append(args.copilot_summary)
    if args.recap_file:
        updates.append("recap_file=?")
        params.append(args.recap_file)
    if args.key_decisions:
        updates.append("key_decisions=?")
        params.append(args.key_decisions)
    if args.action_items:
        updates.append("action_items=?")
        params.append(args.action_items)
    if args.recording_url:
        updates.append("recording_url=?")
        params.append(args.recording_url)

    params.append(args.event_id)
    conn.execute(f"UPDATE meetings SET {', '.join(updates)} WHERE event_id=?", params)
    conn.commit()
    print(f"recapped: {args.event_id}")
    conn.close()
    return 0


def cmd_meeting_list(args) -> int:
    conn = get_db(readonly=True)
    ensure_schema(conn)
    sql = "SELECT * FROM meetings"
    params: list = []
    if args.date:
        sql += " WHERE date=?"
        params.append(args.date)
    sql += " ORDER BY date DESC, start_time DESC"
    rows = conn.execute(sql, params).fetchall()
    print(json.dumps([dict(r) for r in rows], indent=2))
    conn.close()
    return 0


def cmd_meeting_show(args) -> int:
    conn = get_db(readonly=True)
    ensure_schema(conn)
    row = conn.execute("SELECT * FROM meetings WHERE event_id=?",
                        (args.event_id,)).fetchone()
    if not row:
        sys.stderr.write(f"unknown event: {args.event_id}\n")
        return 1
    print(json.dumps(dict(row), indent=2))
    conn.close()
    return 0


def cmd_meeting_pending(args) -> int:
    """Filter piped JSON event list for 'needs briefing now'."""
    raw = sys.stdin.read().strip()
    if not raw:
        sys.stderr.write("no event JSON on stdin\n")
        return 2
    try:
        events = json.loads(raw)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"invalid JSON on stdin: {e}\n")
        return 2

    conn = get_db(readonly=True)
    ensure_schema(conn)
    cutoff = datetime.now(timezone.utc) + timedelta(minutes=args.within_min)
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
            continue
        existing = conn.execute("SELECT brief_status FROM meetings WHERE event_id=?",
                                 (ev["event_id"],)).fetchone()
        if existing and existing["brief_status"] in ("sent", "refreshed"):
            continue
        # High-stakes check
        ext = int(ev.get("external_count", 0))
        if ext < 1:
            title = ev.get("title", "")
            dur = 0
            if "end" in ev and "start" in ev:
                try:
                    dur = int((parse_iso(ev["end"]) - parse_iso(ev["start"])).total_seconds() // 60)
                except Exception:
                    pass
            if not (HIGH_STAKES_RE.search(title) and dur >= 25):
                continue
        out.append(ev)
    conn.close()
    print(json.dumps(out, indent=2))
    return 0


def cmd_meeting_recap_pending(args) -> int:
    """Filter piped JSON event list for 'ended today, not yet recapped'."""
    raw = sys.stdin.read().strip()
    if not raw:
        sys.stderr.write("no event JSON on stdin\n")
        return 2
    try:
        events = json.loads(raw)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"invalid JSON on stdin: {e}\n")
        return 2

    conn = get_db(readonly=True)
    ensure_schema(conn)
    now = datetime.now(timezone.utc)
    today_str = now.astimezone().strftime("%Y-%m-%d")
    max_age = timedelta(minutes=args.max_age_min)
    out = []
    for ev in events:
        if not all(k in ev for k in ("event_id", "title", "end")):
            continue
        try:
            end = parse_iso(ev["end"]).astimezone(timezone.utc)
        except Exception:
            continue
        if end.astimezone().strftime("%Y-%m-%d") != today_str:
            continue
        if end > now:
            continue
        if (now - end) > max_age:
            continue
        existing = conn.execute("SELECT recap_status FROM meetings WHERE event_id=?",
                                 (ev["event_id"],)).fetchone()
        if existing and existing["recap_status"] == "recapped":
            continue
        out.append(ev)
    conn.close()
    print(json.dumps(out, indent=2))
    return 0


# ---- interaction subcommands ------------------------------------------------

def cmd_interaction_log(args) -> int:
    conn = get_db()
    ensure_schema(conn)
    ts = args.timestamp or datetime.now().strftime("%Y-%m-%d %H:%M")
    conn.execute(
        "INSERT INTO interactions (person, type, direction, summary, source_id, "
        "category, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (args.person, args.type, args.direction, args.summary,
         args.source_id, args.category, ts)
    )
    conn.commit()
    row_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    print(json.dumps({"id": row_id, "person": args.person, "timestamp": ts}))
    conn.close()
    return 0


def cmd_interaction_last(args) -> int:
    conn = get_db(readonly=True)
    ensure_schema(conn)
    row = conn.execute(
        "SELECT * FROM interactions WHERE person LIKE ? ORDER BY timestamp DESC LIMIT 1",
        (f"%{args.person}%",)
    ).fetchone()
    if not row:
        print(json.dumps({"person": args.person, "last_interaction": None}))
    else:
        print(json.dumps(dict(row), indent=2))
    conn.close()
    return 0


def cmd_interaction_list(args) -> int:
    conn = get_db(readonly=True)
    ensure_schema(conn)
    sql = "SELECT * FROM interactions WHERE 1=1"
    params: list = []
    if args.person:
        sql += " AND person LIKE ?"
        params.append(f"%{args.person}%")
    if args.type:
        sql += " AND type=?"
        params.append(args.type)
    if args.category:
        sql += " AND category=?"
        params.append(args.category)
    if args.days:
        sql += " AND timestamp >= date('now', ?, 'localtime')"
        params.append(f"-{args.days} days")
    sql += " ORDER BY timestamp DESC"
    if args.limit:
        sql += " LIMIT ?"
        params.append(args.limit)
    rows = conn.execute(sql, params).fetchall()
    print(json.dumps([dict(r) for r in rows], indent=2))
    conn.close()
    return 0


# ---- sync things 3 ----------------------------------------------------------

def push_to_things3(title: str, task_id: str, direction: str,
                    person: str | None, due: str | None,
                    category: str | None, notes: str | None) -> str | None:
    """Push a task to Things 3 via add.sh. Returns nothing (UUID found on next sync)."""
    if not THINGS3_ADD.exists():
        sys.stderr.write("things3/add.sh not found, skipping push\n")
        return None

    cmd = [str(THINGS3_ADD), title, "--task-id", task_id]

    # Map category to Things 3 area
    area_map = {"work": "Work", "personal": "Personal", "church": "Church", "hmbl": "HMBL"}
    if category and category in area_map:
        cmd.extend(["--area", area_map[category]])

    if due and due != "ASAP":
        cmd.extend(["--deadline", due])

    note_parts = []
    if notes:
        note_parts.append(notes)
    if person and direction == "mine":
        note_parts.append(f"Owed to: {person}")
    elif person and direction == "theirs":
        note_parts.append(f"Owed by: {person}")
    if note_parts:
        cmd.extend(["--notes", "\n".join(note_parts)])

    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    except Exception as e:
        sys.stderr.write(f"things3 push failed: {e}\n")

    return None  # UUID resolved on next sync-things3 run


def cmd_sync_things3(args) -> int:
    """Pull completions from Things 3 back into assistant.db."""
    if not THINGS3_DB.exists():
        sys.stderr.write(f"Things 3 DB not found: {THINGS3_DB}\n")
        return 1

    conn = get_db()
    ensure_schema(conn)

    # Connect to Things 3 DB (read-only)
    t3uri = f"file:{THINGS3_DB}?mode=ro"
    t3 = sqlite3.connect(t3uri, uri=True)
    t3.row_factory = sqlite3.Row

    synced = 0

    # 1. For commitments with things3_uuid: check completion status
    rows = conn.execute(
        "SELECT task_id, things3_uuid FROM commitments "
        "WHERE things3_uuid IS NOT NULL AND status='active'"
    ).fetchall()
    for r in rows:
        t3row = t3.execute(
            "SELECT status FROM TMTask WHERE uuid=?", (r["things3_uuid"],)
        ).fetchone()
        if t3row and t3row["status"] == 3:  # 3 = completed in Things 3
            conn.execute(
                "UPDATE commitments SET status='completed', "
                "completed_at=date('now','localtime') WHERE task_id=?",
                (r["task_id"],)
            )
            synced += 1

    # 2. For commitments without things3_uuid: try to match by Task ID in notes
    rows = conn.execute(
        "SELECT task_id FROM commitments "
        "WHERE things3_uuid IS NULL AND status='active'"
    ).fetchall()
    for r in rows:
        pattern = f"%Task ID: {r['task_id']}%"
        t3row = t3.execute(
            "SELECT uuid, status FROM TMTask WHERE notes LIKE ? AND trashed=0 AND type=0",
            (pattern,)
        ).fetchone()
        if t3row:
            updates = ["things3_uuid=?"]
            params: list = [t3row["uuid"]]
            if t3row["status"] == 3:
                updates.append("status='completed'")
                updates.append("completed_at=date('now','localtime')")
                synced += 1
            params.append(r["task_id"])
            conn.execute(
                f"UPDATE commitments SET {', '.join(updates)} WHERE task_id=?",
                params
            )

    conn.commit()
    t3.close()

    if synced > 0 and not args.no_render:
        do_render(conn)

    print(json.dumps({"synced_completions": synced}))
    conn.close()
    return 0


# ---- render command ----------------------------------------------------------

def cmd_render(args) -> int:
    conn = get_db(readonly=True)
    ensure_schema(conn)
    do_render(conn)
    print("rendered: action-items.md, waiting-on-others.md")
    conn.close()
    return 0


# ---- import ------------------------------------------------------------------

TASK_ID_RE = re.compile(r"Task ID:\s*(AI-\d{8}-\d{6})")
PIPE_SEP = re.compile(r"\s*\|\s*")


def parse_action_item_line(line: str) -> dict | None:
    """Parse a line like: - [ ] Title | Owed to: X | Source: Y | Due: Z | Things3: yes"""
    m = re.match(r"^- \[( |x)\]\s+(.+)$", line.strip())
    if not m:
        return None
    checked = m.group(1) == "x"
    rest = m.group(2)
    parts = PIPE_SEP.split(rest)

    item: dict = {"status": "completed" if checked else "active"}
    item["title"] = parts[0].strip()
    for part in parts[1:]:
        part = part.strip()
        kv = part.split(":", 1)
        if len(kv) != 2:
            continue
        key, val = kv[0].strip().lower(), kv[1].strip()
        if key == "owed to":
            item["person"] = val
        elif key == "source":
            item["source"] = val
        elif key == "due":
            # Strip overdue annotations
            val = re.sub(r"\s*\(\d+ days.*?\)", "", val).strip()
            item["due_date"] = val
        elif key == "things3":
            item["things3"] = val.lower() == "yes"
        elif key == "task id":
            item["task_id"] = val
        elif key == "completed":
            item["completed_at"] = val
        elif key == "channel":
            item["channel"] = val
        elif key == "last nudge":
            if val.lower() != "never":
                item["last_nudge"] = val
        elif key == "status":
            item["notes"] = val

    # Extract Task ID from title if present
    tid = TASK_ID_RE.search(rest)
    if tid and "task_id" not in item:
        item["task_id"] = tid.group(1)

    return item


def parse_waiting_line(line: str) -> dict | None:
    """Parse: - [ ] **Person** | Title | Due: ... | Last nudge: ... | Channel: ..."""
    m = re.match(r"^- \[( |x)\]\s+(.+)$", line.strip())
    if not m:
        return None
    checked = m.group(1) == "x"
    rest = m.group(2)
    parts = PIPE_SEP.split(rest)

    item: dict = {"status": "completed" if checked else "active", "direction": "theirs"}

    # First part is **Person**
    person_match = re.match(r"\*\*(.+?)\*\*", parts[0].strip())
    if person_match:
        item["person"] = person_match.group(1)

    # Second part is the title
    if len(parts) > 1:
        item["title"] = parts[1].strip()
    else:
        item["title"] = parts[0].strip()

    for part in parts[2:]:
        part = part.strip()
        kv = part.split(":", 1)
        if len(kv) != 2:
            continue
        key, val = kv[0].strip().lower(), kv[1].strip()
        if key == "due":
            val = re.sub(r"\s*\(\d+ days.*?\)", "", val).strip()
            item["due_date"] = val
        elif key == "last nudge":
            if val.lower() != "never":
                item["last_nudge"] = val
        elif key == "channel":
            item["channel"] = val
        elif key == "status":
            item["notes"] = val
        elif key == "resolved":
            item["completed_at"] = val
        elif key == "task id":
            item["task_id"] = val

    return item


def cmd_import_markdown(args) -> int:
    """Import existing action-items.md and waiting-on-others.md into the DB."""
    conn = get_db()
    ensure_schema(conn)
    imported = 0
    skipped = 0
    counter = 0

    # Import action items (direction=mine)
    if ACTION_ITEMS_PATH.exists():
        for line in ACTION_ITEMS_PATH.read_text().splitlines():
            if not line.strip().startswith("- ["):
                continue
            item = parse_action_item_line(line)
            if not item:
                continue

            task_id = item.get("task_id") or f"IMPORT-{datetime.now().strftime('%Y%m%d')}-{counter:04d}"
            counter += 1

            existing = conn.execute("SELECT task_id FROM commitments WHERE task_id=?",
                                     (task_id,)).fetchone()
            if existing:
                skipped += 1
                continue

            conn.execute(
                "INSERT INTO commitments (task_id, title, direction, person, source, "
                "channel, due_date, status, completed_at, last_nudge, notes) "
                "VALUES (?, ?, 'mine', ?, ?, ?, ?, ?, ?, ?, ?)",
                (task_id, item.get("title", ""), item.get("person"),
                 item.get("source"), item.get("channel"), item.get("due_date"),
                 item.get("status", "active"), item.get("completed_at"),
                 item.get("last_nudge"), item.get("notes"))
            )
            imported += 1

    # Import waiting-on-others (direction=theirs)
    if WAITING_ON_PATH.exists():
        for line in WAITING_ON_PATH.read_text().splitlines():
            if not line.strip().startswith("- ["):
                continue
            item = parse_waiting_line(line)
            if not item:
                continue

            task_id = item.get("task_id") or f"IMPORT-{datetime.now().strftime('%Y%m%d')}-{counter:04d}"
            counter += 1

            existing = conn.execute("SELECT task_id FROM commitments WHERE task_id=?",
                                     (task_id,)).fetchone()
            if existing:
                skipped += 1
                continue

            conn.execute(
                "INSERT INTO commitments (task_id, title, direction, person, source, "
                "channel, due_date, status, completed_at, last_nudge, notes) "
                "VALUES (?, ?, 'theirs', ?, ?, ?, ?, ?, ?, ?, ?)",
                (task_id, item.get("title", ""), item.get("person"),
                 item.get("source"), item.get("channel"), item.get("due_date"),
                 item.get("status", "active"), item.get("completed_at"),
                 item.get("last_nudge"), item.get("notes"))
            )
            imported += 1

    conn.commit()
    do_render(conn)
    print(json.dumps({"imported": imported, "skipped": skipped}))
    conn.close()
    return 0


def cmd_import_ledger(args) -> int:
    """Import meeting-briefs.json into the meetings table."""
    if not LEDGER_PATH.exists():
        print(json.dumps({"imported": 0, "message": "no ledger file found"}))
        return 0

    try:
        ledger = json.loads(LEDGER_PATH.read_text())
    except json.JSONDecodeError:
        sys.stderr.write("corrupt ledger JSON\n")
        return 1

    conn = get_db()
    ensure_schema(conn)
    imported = 0

    for event_id, entry in ledger.get("events", {}).items():
        existing = conn.execute("SELECT event_id FROM meetings WHERE event_id=?",
                                 (event_id,)).fetchone()
        if existing:
            continue

        start = entry.get("start", "")
        date_str = ""
        if start:
            try:
                date_str = parse_iso(start).astimezone().strftime("%Y-%m-%d")
            except Exception:
                pass

        # Map ledger status to brief_status / recap_status
        status = entry.get("status", "")
        brief_status = status if status in ("pending", "sent", "skipped", "failed", "refreshed") else None
        recap_status = "recapped" if status == "recapped" else ("recap-failed" if status == "recap-failed" else None)

        conn.execute(
            "INSERT INTO meetings (event_id, title, date, start_time, "
            "external_count, brief_status, brief_file, recap_status, recap_file, "
            "recap_summary, refresh_count, claimed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (event_id, entry.get("title", ""), date_str, start,
             entry.get("external_count", 0), brief_status,
             entry.get("file"), recap_status, entry.get("recap_file"),
             entry.get("recap_summary"), entry.get("refresh_count", 0),
             entry.get("claimed_at"))
        )
        imported += 1

    conn.commit()
    print(json.dumps({"imported": imported}))
    conn.close()
    return 0


# ---- dump --------------------------------------------------------------------

def cmd_dump(args) -> int:
    """Export full DB to JSON for backup/debugging."""
    conn = get_db(readonly=True)
    ensure_schema(conn)
    data = {
        "exported_at": datetime.now().isoformat(),
        "commitments": [dict(r) for r in conn.execute("SELECT * FROM commitments ORDER BY created_at").fetchall()],
        "meetings": [dict(r) for r in conn.execute("SELECT * FROM meetings ORDER BY date DESC").fetchall()],
        "interactions": [dict(r) for r in conn.execute("SELECT * FROM interactions ORDER BY timestamp DESC").fetchall()],
    }
    print(json.dumps(data, indent=2))
    conn.close()
    return 0


# ---- init --------------------------------------------------------------------

def cmd_init(args) -> int:
    conn = get_db()
    ensure_schema(conn)
    conn.commit()
    print(f"initialized: {DB_PATH}")
    conn.close()
    return 0


# ---- argparse ----------------------------------------------------------------

def add_render_flag(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--no-render", action="store_true",
                        help="Skip markdown render after write")


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Atlas DB: unified data store for the personal assistant"
    )
    sub = ap.add_subparsers(dest="group", required=True)

    # init
    sub.add_parser("init", help="Initialize the database")

    # commit
    commit_parser = sub.add_parser("commit", help="Manage commitments")
    csub = commit_parser.add_subparsers(dest="cmd", required=True)

    s = csub.add_parser("add", help="Add a commitment")
    s.add_argument("--title", required=True)
    s.add_argument("--direction", required=True, choices=["mine", "theirs"])
    s.add_argument("--person")
    s.add_argument("--category", choices=["work", "personal", "church", "hmbl"])
    s.add_argument("--source")
    s.add_argument("--channel")
    s.add_argument("--due")
    s.add_argument("--notes")
    s.add_argument("--task-id", dest="task_id")
    s.add_argument("--no-push", action="store_true", help="Skip Things 3 push")
    add_render_flag(s)

    s = csub.add_parser("complete", help="Complete a commitment")
    s.add_argument("--task-id", dest="task_id", required=True)
    s.add_argument("--no-push", action="store_true", help="Skip Things 3 completion push")
    add_render_flag(s)

    s = csub.add_parser("cancel", help="Cancel a commitment")
    s.add_argument("--task-id", dest="task_id", required=True)
    add_render_flag(s)

    s = csub.add_parser("list", help="List commitments")
    s.add_argument("--direction", choices=["mine", "theirs"])
    s.add_argument("--status", choices=["active", "completed", "cancelled"])
    s.add_argument("--person")
    s.add_argument("--category", choices=["work", "personal", "church", "hmbl"])

    s = csub.add_parser("overdue", help="List overdue commitments")

    s = csub.add_parser("search", help="Search commitments")
    s.add_argument("--query", required=True)

    s = csub.add_parser("nudge", help="Record a nudge")
    s.add_argument("--task-id", dest="task_id", required=True)
    s.add_argument("--channel")
    add_render_flag(s)

    # meeting
    meeting_parser = sub.add_parser("meeting", help="Manage meetings")
    msub = meeting_parser.add_subparsers(dest="cmd", required=True)

    s = msub.add_parser("add", help="Add/claim a meeting")
    s.add_argument("--event-id", dest="event_id", required=True)
    s.add_argument("--title", required=True)
    s.add_argument("--start", required=True, help="ISO start time")
    s.add_argument("--end")
    s.add_argument("--attendees")
    s.add_argument("--external", type=int, default=0)
    s.add_argument("--category", choices=["work", "personal", "church", "hmbl"])

    s = msub.add_parser("mark", help="Update brief status")
    s.add_argument("--event-id", dest="event_id", required=True)
    s.add_argument("--status", required=True)
    s.add_argument("--file")

    s = msub.add_parser("recap", help="Store a meeting recap")
    s.add_argument("--event-id", dest="event_id", required=True)
    s.add_argument("--title")
    s.add_argument("--summary")
    s.add_argument("--copilot-summary", dest="copilot_summary")
    s.add_argument("--recap-file", dest="recap_file")
    s.add_argument("--key-decisions", dest="key_decisions")
    s.add_argument("--action-items", dest="action_items")
    s.add_argument("--recording-url", dest="recording_url")

    s = msub.add_parser("list", help="List meetings")
    s.add_argument("--date")

    s = msub.add_parser("show", help="Show meeting details")
    s.add_argument("--event-id", dest="event_id", required=True)

    s = msub.add_parser("pending", help="Filter stdin JSON for meetings needing briefs")
    s.add_argument("--within-min", dest="within_min", type=int, default=30)

    s = msub.add_parser("recap-pending", help="Filter stdin JSON for meetings needing recaps")
    s.add_argument("--max-age-min", dest="max_age_min", type=int, default=60)

    # interaction
    ix_parser = sub.add_parser("interaction", help="Track person interactions")
    isub = ix_parser.add_subparsers(dest="cmd", required=True)

    s = isub.add_parser("log", help="Log an interaction")
    s.add_argument("--person", required=True)
    s.add_argument("--type", dest="type",
                   choices=["email", "teams", "meeting", "imessage", "phone", "nudge"])
    s.add_argument("--direction", choices=["inbound", "outbound"])
    s.add_argument("--summary")
    s.add_argument("--source-id", dest="source_id")
    s.add_argument("--category", choices=["work", "personal", "church", "hmbl"])
    s.add_argument("--timestamp")

    s = isub.add_parser("last", help="Last interaction with a person")
    s.add_argument("--person", required=True)

    s = isub.add_parser("list", help="List interactions")
    s.add_argument("--person")
    s.add_argument("--type", dest="type")
    s.add_argument("--category", choices=["work", "personal", "church", "hmbl"])
    s.add_argument("--days", type=int)
    s.add_argument("--limit", type=int)

    # sync-things3
    s = sub.add_parser("sync-things3", help="Pull completions from Things 3")
    add_render_flag(s)

    # render
    sub.add_parser("render", help="Re-render markdown views from DB")

    # import
    sub.add_parser("import-markdown", help="Import action-items.md and waiting-on-others.md")
    sub.add_parser("import-ledger", help="Import meeting-briefs.json into meetings table")

    # dump
    sub.add_parser("dump", help="Export full DB to JSON")

    args = ap.parse_args()

    dispatch = {
        ("init", None): lambda: cmd_init(args),
        ("commit", "add"): lambda: cmd_commit_add(args),
        ("commit", "complete"): lambda: cmd_commit_complete(args),
        ("commit", "cancel"): lambda: cmd_commit_cancel(args),
        ("commit", "list"): lambda: cmd_commit_list(args),
        ("commit", "overdue"): lambda: cmd_commit_overdue(args),
        ("commit", "search"): lambda: cmd_commit_search(args),
        ("commit", "nudge"): lambda: cmd_commit_nudge(args),
        ("meeting", "add"): lambda: cmd_meeting_add(args),
        ("meeting", "mark"): lambda: cmd_meeting_mark(args),
        ("meeting", "recap"): lambda: cmd_meeting_recap(args),
        ("meeting", "list"): lambda: cmd_meeting_list(args),
        ("meeting", "show"): lambda: cmd_meeting_show(args),
        ("meeting", "pending"): lambda: cmd_meeting_pending(args),
        ("meeting", "recap-pending"): lambda: cmd_meeting_recap_pending(args),
        ("interaction", "log"): lambda: cmd_interaction_log(args),
        ("interaction", "last"): lambda: cmd_interaction_last(args),
        ("interaction", "list"): lambda: cmd_interaction_list(args),
        ("sync-things3", None): lambda: cmd_sync_things3(args),
        ("render", None): lambda: cmd_render(args),
        ("import-markdown", None): lambda: cmd_import_markdown(args),
        ("import-ledger", None): lambda: cmd_import_ledger(args),
        ("dump", None): lambda: cmd_dump(args),
    }

    key = (args.group, getattr(args, "cmd", None))
    fn = dispatch.get(key)
    if not fn:
        ap.print_help()
        return 2
    return fn()


if __name__ == "__main__":
    sys.exit(main())
