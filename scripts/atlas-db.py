#!/usr/bin/env python3
"""
atlas-db: Unified data store for the personal assistant system.

Source of truth for commitments, meetings, interactions, objectives, and MITs.
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
  atlas-db.py sync-things3 [--dry-run] [--since-days N]
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
from datetime import date, datetime, timezone, timedelta
from contextlib import contextmanager
from pathlib import Path
from textwrap import dedent

# ---- config ------------------------------------------------------------------


def _parse_simple_yaml(text: str) -> dict:
    """Parse a minimal YAML subset (scalars, flat dicts, lists of flat dicts).

    Handles only the structure used by config.yaml. NOT a general YAML parser.
    """
    result: dict = {}
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.split("#")[0].rstrip() if "#" in line and not (line.strip().startswith('"') or line.strip().startswith("'")) else line.rstrip()
        # More careful comment stripping: only strip # outside quotes
        raw = lines[i].rstrip()
        if not raw or raw.lstrip().startswith("#"):
            i += 1
            continue
        # Top-level key (no leading whitespace)
        if raw[0] not in (" ", "\t", "-"):
            colon_idx = raw.find(":")
            if colon_idx == -1:
                i += 1
                continue
            key = raw[:colon_idx].strip()
            rest = raw[colon_idx + 1 :].strip()
            # Strip inline comments (outside quotes)
            rest = _strip_comment(rest)
            if rest:
                result[key] = _unquote(rest)
                i += 1
                continue
            # Peek ahead to determine if list or dict
            j = i + 1
            while j < len(lines) and (not lines[j].strip() or lines[j].strip().startswith("#")):
                j += 1
            if j < len(lines) and lines[j].lstrip().startswith("- "):
                # List of dicts
                items: list[dict] = []
                while j < len(lines):
                    ln = lines[j]
                    if not ln.strip() or ln.strip().startswith("#"):
                        j += 1
                        continue
                    if ln[0] not in (" ", "\t", "-") and not ln.startswith("  "):
                        break
                    if ln.lstrip().startswith("- "):
                        item: dict = {}
                        entry = ln.lstrip()[2:]
                        ck, cv = _split_kv(entry)
                        if ck:
                            item[ck] = _unquote(_strip_comment(cv))
                        j += 1
                        # Continuation lines for this list item
                        while j < len(lines):
                            cl = lines[j]
                            if not cl.strip() or cl.strip().startswith("#"):
                                j += 1
                                continue
                            indent = len(cl) - len(cl.lstrip())
                            if indent < 4 and not cl.lstrip().startswith("- "):
                                break
                            if cl.lstrip().startswith("- "):
                                break
                            ck2, cv2 = _split_kv(cl.strip())
                            if ck2:
                                item[ck2] = _unquote(_strip_comment(cv2))
                            j += 1
                        items.append(item)
                    else:
                        j += 1
                result[key] = items
                i = j
                continue
            else:
                # Nested dict
                sub: dict = {}
                while j < len(lines):
                    ln = lines[j]
                    if not ln.strip() or ln.strip().startswith("#"):
                        j += 1
                        continue
                    if ln[0] not in (" ", "\t"):
                        break
                    indent = len(ln) - len(ln.lstrip())
                    sk, sv = _split_kv(ln.strip())
                    if sk and sv:
                        sub[sk] = _unquote(_strip_comment(sv))
                    elif sk and not sv:
                        # Sub-sub dict (e.g., workflows.ado)
                        inner: dict = {}
                        j += 1
                        while j < len(lines):
                            il = lines[j]
                            if not il.strip() or il.strip().startswith("#"):
                                j += 1
                                continue
                            ii = len(il) - len(il.lstrip())
                            if ii <= indent:
                                break
                            ik, iv = _split_kv(il.strip())
                            if ik:
                                inner[ik] = _unquote(_strip_comment(iv))
                            j += 1
                        sub[sk] = inner
                        continue
                    j += 1
                result[key] = sub
                i = j
                continue
        i += 1
    return result


def _split_kv(s: str) -> tuple[str, str]:
    idx = s.find(":")
    if idx == -1:
        return ("", "")
    return s[:idx].strip(), s[idx + 1 :].strip()


def _unquote(s: str) -> str:
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ('"', "'"):
        return s[1:-1]
    return s


def _strip_comment(s: str) -> str:
    """Strip trailing # comments, respecting quoted strings."""
    if not s:
        return s
    in_quote = None
    for i, ch in enumerate(s):
        if ch in ('"', "'") and in_quote is None:
            in_quote = ch
        elif ch == in_quote:
            in_quote = None
        elif ch == "#" and in_quote is None:
            return s[:i].rstrip()
    return s


def _load_config() -> dict:
    """Load config.yaml from data/ or data-templates/. Returns {} on failure."""
    for candidate in (_DATA_DIR / "config.yaml", ASSISTANT_ROOT / "data-templates" / "config.yaml"):
        if candidate.is_file():
            try:
                return _parse_simple_yaml(candidate.read_text())
            except Exception:
                return {}
    return {}


def _derive_categories(cfg: dict) -> tuple[tuple[str, ...], dict[str, str]]:
    """Derive CATEGORIES tuple and CATEGORY_AREA_MAP from config."""
    cats_list = cfg.get("categories", [])
    if not cats_list or not isinstance(cats_list, list):
        return (("work", "personal"), {"work": "Work", "personal": "Personal"})
    ids = tuple(c["id"] for c in cats_list if "id" in c)
    area_map = {c["id"]: c.get("label", c["id"].title()) for c in cats_list if "id" in c}
    return ids, area_map


def _derive_channel_tags(cfg: dict) -> dict[str, str]:
    """Derive CHANNEL_TAG_MAP from config."""
    return cfg.get("channel_tags", {})


# ---- constants ---------------------------------------------------------------

DIRECTIONS = ("mine", "theirs")
COMMIT_STATUSES = ("active", "completed", "cancelled")
INTERACTION_DIRECTIONS = ("inbound", "outbound")
INTERACTION_TYPES = ("email", "teams", "meeting", "imessage", "phone", "nudge")
BRIEF_STATUSES = ("pending", "sent", "skipped", "failed", "refreshed")

# ---- paths -------------------------------------------------------------------

ASSISTANT_ROOT = Path(__file__).resolve().parents[1]  # assistant/
_DATA_DIR = Path(os.environ.get("ATLAS_DATA_DIR", "")) if os.environ.get("ATLAS_DATA_DIR") else ASSISTANT_ROOT / "data"
DB_PATH = Path(os.environ.get("ATLAS_DB_PATH", "")) if os.environ.get("ATLAS_DB_PATH") else _DATA_DIR / "state" / "assistant.db"
_CONTEXT_DIR = Path(os.environ.get("ATLAS_CONTEXT_DIR", "")) if os.environ.get("ATLAS_CONTEXT_DIR") else _DATA_DIR / "context"
ACTION_ITEMS_PATH = _CONTEXT_DIR / "action-items.md"
WAITING_ON_PATH = _CONTEXT_DIR / "waiting-on-others.md"
LEDGER_PATH = _DATA_DIR / "state" / "meeting-briefs.json"
OBJECTIVES_PATH = _CONTEXT_DIR / "objectives.md"
THINGS3_DB = Path.home() / "Library" / "Group Containers" / \
    "JLMPQHK86H.com.culturedcode.ThingsMac" / "ThingsData-BX8ZL" / \
    "Things Database.thingsdatabase" / "main.sqlite"
THINGS3_ADD = ASSISTANT_ROOT / "things3" / "add.sh"
THINGS3_COMPLETE = ASSISTANT_ROOT / "things3" / "complete.sh"

# ---- config-derived constants ------------------------------------------------

_CONFIG = _load_config()
CATEGORIES, CATEGORY_AREA_MAP = _derive_categories(_CONFIG)
CHANNEL_TAG_MAP_CFG = _derive_channel_tags(_CONFIG)
OBJECTIVE_STATUSES = ("proposed", "active", "completed", "dropped", "carried")
MIT_STATUSES = ("active", "completed", "deferred")

# ---- schema ------------------------------------------------------------------

SCHEMA_VERSION = 2

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
    category      TEXT,
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
    category             TEXT,
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
    category  TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS objectives (
    id            TEXT PRIMARY KEY,
    week          TEXT NOT NULL,
    rank          INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 3),
    title         TEXT NOT NULL,
    outcome       TEXT,
    category      TEXT,
    status        TEXT DEFAULT 'proposed' CHECK(status IN ('proposed', 'active', 'completed', 'dropped', 'carried')),
    created_at    TEXT DEFAULT (datetime('now', 'localtime')),
    completed_at  TEXT
);

CREATE TABLE IF NOT EXISTS objective_tasks (
    objective_id  TEXT NOT NULL,
    task_id       TEXT NOT NULL,
    PRIMARY KEY (objective_id, task_id)
);

CREATE TABLE IF NOT EXISTS daily_mits (
    id            TEXT PRIMARY KEY,
    date          TEXT NOT NULL,
    rank          INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 3),
    objective_id  TEXT,
    task_id       TEXT,
    title         TEXT NOT NULL,
    status        TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'deferred')),
    completed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_commitments_direction ON commitments(direction);
CREATE INDEX IF NOT EXISTS idx_commitments_status    ON commitments(status);
CREATE INDEX IF NOT EXISTS idx_commitments_person    ON commitments(person);
CREATE INDEX IF NOT EXISTS idx_commitments_category  ON commitments(category);
CREATE INDEX IF NOT EXISTS idx_commitments_due       ON commitments(due_date);
CREATE INDEX IF NOT EXISTS idx_meetings_date         ON meetings(date);
CREATE INDEX IF NOT EXISTS idx_interactions_person    ON interactions(person);
CREATE INDEX IF NOT EXISTS idx_interactions_timestamp ON interactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_objectives_week       ON objectives(week);
CREATE INDEX IF NOT EXISTS idx_objectives_status     ON objectives(status);
CREATE INDEX IF NOT EXISTS idx_daily_mits_date       ON daily_mits(date);
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


@contextmanager
def open_db(readonly: bool = False):
    """Context manager that yields a DB connection and closes it on exit."""
    conn = get_db(readonly=readonly)
    try:
        yield conn
    finally:
        conn.close()


def ensure_schema(conn: sqlite3.Connection) -> None:
    # Detect if connection is read-only by attempting a no-op write
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS _ping_test (x INTEGER)")
        conn.execute("DROP TABLE IF EXISTS _ping_test")
        writable = True
    except sqlite3.OperationalError:
        writable = False

    if writable:
        conn.executescript(SCHEMA_SQL)
        row = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        current = int(row["value"]) if row else 0

        if current < SCHEMA_VERSION:
            _run_migrations(conn, current)

        if not row:
            conn.execute("INSERT INTO meta (key, value) VALUES ('schema_version', ?)",
                          (str(SCHEMA_VERSION),))
        elif current < SCHEMA_VERSION:
            conn.execute("UPDATE meta SET value=? WHERE key='schema_version'",
                          (str(SCHEMA_VERSION),))
        conn.commit()
    else:
        # Read-only: just check version for compatibility warning
        try:
            row = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
            current = int(row["value"]) if row else 0
            if current < SCHEMA_VERSION:
                sys.stderr.write(
                    f"warning: DB schema v{current} < v{SCHEMA_VERSION}; "
                    f"run a write command to auto-migrate\n")
        except sqlite3.OperationalError:
            pass


# Migration registry: version -> callable(conn)
# Each migration brings the DB from version N-1 to N.
# Add new migrations here as the schema evolves.


def _migrate_v2(conn: sqlite3.Connection) -> None:
    """Add objectives, objective_tasks, and daily_mits tables."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS objectives (
            id            TEXT PRIMARY KEY,
            week          TEXT NOT NULL,
            rank          INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 3),
            title         TEXT NOT NULL,
            outcome       TEXT,
            category      TEXT,
            status        TEXT DEFAULT 'proposed' CHECK(status IN ('proposed', 'active', 'completed', 'dropped', 'carried')),
            created_at    TEXT DEFAULT (datetime('now', 'localtime')),
            completed_at  TEXT
        );
        CREATE TABLE IF NOT EXISTS objective_tasks (
            objective_id  TEXT NOT NULL,
            task_id       TEXT NOT NULL,
            PRIMARY KEY (objective_id, task_id)
        );
        CREATE TABLE IF NOT EXISTS daily_mits (
            id            TEXT PRIMARY KEY,
            date          TEXT NOT NULL,
            rank          INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 3),
            objective_id  TEXT,
            task_id       TEXT,
            title         TEXT NOT NULL,
            status        TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'deferred')),
            completed_at  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_objectives_week   ON objectives(week);
        CREATE INDEX IF NOT EXISTS idx_objectives_status  ON objectives(status);
        CREATE INDEX IF NOT EXISTS idx_daily_mits_date    ON daily_mits(date);
    """)


MIGRATIONS: dict[int, callable] = {
    # 1: initial schema (handled by SCHEMA_SQL CREATE IF NOT EXISTS)
    2: _migrate_v2,
}


def _run_migrations(conn: sqlite3.Connection, current: int) -> None:
    """Apply migrations sequentially from current+1 to SCHEMA_VERSION."""
    for ver in range(current + 1, SCHEMA_VERSION + 1):
        migration = MIGRATIONS.get(ver)
        if migration:
            sys.stderr.write(f"migrating schema v{ver - 1} -> v{ver}\n")
            migration(conn)


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
        "Things the user owes others. Synced to Things 3.\n",
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
        "Commitments others have made to the user. Nudgeable via nudge agent.\n",
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


def render_objectives(conn: sqlite3.Connection) -> None:
    """Generate objectives.md with current week objectives and today's MITs."""
    week = _iso_week()
    today = _today_str()

    # Gracefully handle pre-migration DB (tables may not exist yet)
    try:
        objs = conn.execute(
            "SELECT * FROM objectives WHERE week=? AND status IN ('active','proposed') ORDER BY rank",
            (week,)).fetchall()
    except sqlite3.OperationalError:
        objs = []
    try:
        mits = conn.execute(
            "SELECT * FROM daily_mits WHERE date=? ORDER BY rank", (today,)).fetchall()
    except sqlite3.OperationalError:
        mits = []

    lines = [
        "# Weekly Objectives & Daily MITs\n",
        f"Week: {week} | Today: {today}\n",
    ]

    lines.append("## Weekly Objectives (Top 3)\n")
    if objs:
        for r in objs:
            marker = "x" if r["status"] == "completed" else " "
            status_tag = f" [{r['status']}]" if r["status"] != "active" else ""
            lines.append(f"- [{marker}] **#{r['rank']}** {r['title']}{status_tag}")
            if r["outcome"]:
                lines.append(f"  Outcome: {r['outcome']}")
            if r["category"]:
                lines.append(f"  Category: {r['category']}")
            # Show linked tasks
            tasks = conn.execute("""
                SELECT c.task_id, c.title, c.status FROM objective_tasks ot
                JOIN commitments c ON ot.task_id = c.task_id
                WHERE ot.objective_id = ?
            """, (r["id"],)).fetchall()
            for t in tasks:
                t_marker = "x" if t["status"] == "completed" else " "
                lines.append(f"  - [{t_marker}] {t['title']} ({t['task_id']})")
    else:
        lines.append("_No objectives set for this week._")

    lines.append("\n## Today's MITs (Top 3)\n")
    if mits:
        for r in mits:
            marker = "x" if r["status"] == "completed" else " "
            obj_tag = f" -> {r['objective_id']}" if r["objective_id"] else ""
            lines.append(f"- [{marker}] **#{r['rank']}** {r['title']}{obj_tag}")
    else:
        lines.append("_No MITs set for today._")

    OBJECTIVES_PATH.parent.mkdir(parents=True, exist_ok=True)
    OBJECTIVES_PATH.write_text("\n".join(lines) + "\n")


def do_render(conn: sqlite3.Connection) -> None:
    render_action_items(conn)
    render_waiting_on(conn)
    render_objectives(conn)


# ---- commitment subcommands -------------------------------------------------

def cmd_commit_add(args) -> int:
    with open_db() as conn:
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
        things3_ok = False
        if not args.no_push and THINGS3_ADD.exists():
            things3_ok = push_to_things3(
                title=args.title, task_id=task_id, direction=args.direction,
                person=args.person, due=args.due, category=args.category,
                channel=args.channel, notes=args.notes
            )

        if not args.no_render:
            do_render(conn)

        print(json.dumps({"task_id": task_id, "things3_pushed": things3_ok}))
    return 0


def complete_in_things3(task_id: str, things3_uuid: str | None) -> bool:
    """Push a completion to Things 3 via complete.sh. Returns True on success."""
    if not THINGS3_COMPLETE.exists():
        sys.stderr.write("things3/complete.sh not found, skipping\n")
        return False
    try:
        if things3_uuid:
            result = subprocess.run([str(THINGS3_COMPLETE), things3_uuid],
                                   capture_output=True, text=True, timeout=10)
        else:
            result = subprocess.run([str(THINGS3_COMPLETE), "--task-id", task_id],
                                   capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            sys.stderr.write(f"things3 complete exit {result.returncode}: {result.stderr.strip()}\n")
            return False
        return True
    except Exception as e:
        sys.stderr.write(f"things3 complete failed: {e}\n")
        return False


def cmd_commit_complete(args) -> int:
    with open_db() as conn:
        ensure_schema(conn)

        # Get things3_uuid before updating
        row = conn.execute(
            "SELECT things3_uuid FROM commitments WHERE task_id=? AND status='active'",
            (args.task_id,)
        ).fetchone()
        if not row:
            sys.stderr.write(f"no active commitment: {args.task_id}\n")
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
    return 0


def cmd_commit_cancel(args) -> int:
    with open_db() as conn:
        ensure_schema(conn)
        now = datetime.now().strftime("%Y-%m-%d")
        result = conn.execute(
            "UPDATE commitments SET status='cancelled', completed_at=? "
            "WHERE task_id=? AND status='active'", (now, args.task_id)
        )
        if result.rowcount == 0:
            sys.stderr.write(f"no active commitment: {args.task_id}\n")
            return 1
        conn.commit()
        if not args.no_render:
            do_render(conn)
        print(f"cancelled: {args.task_id}")
    return 0


def cmd_commit_list(args) -> int:
    with open_db(readonly=True) as conn:
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
    return 0


def cmd_commit_overdue(args) -> int:
    with open_db(readonly=True) as conn:
        ensure_schema(conn)
        today = datetime.now().strftime("%Y-%m-%d")
        rows = conn.execute(
            "SELECT * FROM commitments WHERE status='active' "
            "AND due_date IS NOT NULL AND due_date != 'ASAP' AND due_date < ? "
            "ORDER BY due_date, direction", (today,)
        ).fetchall()
        print(json.dumps([dict(r) for r in rows], indent=2))
    return 0


def cmd_commit_search(args) -> int:
    with open_db(readonly=True) as conn:
        ensure_schema(conn)
        rows = conn.execute(
            "SELECT * FROM commitments WHERE title LIKE ? OR person LIKE ? OR notes LIKE ?",
            (f"%{args.query}%", f"%{args.query}%", f"%{args.query}%")
        ).fetchall()
        print(json.dumps([dict(r) for r in rows], indent=2))
    return 0


def cmd_commit_nudge(args) -> int:
    with open_db() as conn:
        ensure_schema(conn)
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        result = conn.execute(
            "UPDATE commitments SET last_nudge=?, nudge_count=nudge_count+1 "
            "WHERE task_id=? AND status='active'", (now, args.task_id)
        )
        if result.rowcount == 0:
            sys.stderr.write(f"no active commitment: {args.task_id}\n")
            return 1
        if args.channel:
            conn.execute("UPDATE commitments SET channel=? WHERE task_id=?",
                          (args.channel, args.task_id))
        conn.commit()
        if not args.no_render:
            do_render(conn)
        print(f"nudged: {args.task_id}")
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
    with open_db() as conn:
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
    return 0


def cmd_meeting_mark(args) -> int:
    with open_db() as conn:
        ensure_schema(conn)
        if args.status not in BRIEF_STATUSES:
            sys.stderr.write(f"invalid brief_status: {args.status} (valid: {BRIEF_STATUSES})\n")
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
    return 0


def cmd_meeting_recap(args) -> int:
    with open_db() as conn:
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
    return 0


def cmd_meeting_list(args) -> int:
    with open_db(readonly=True) as conn:
        ensure_schema(conn)
        sql = "SELECT * FROM meetings"
        params: list = []
        if args.date:
            sql += " WHERE date=?"
            params.append(args.date)
        sql += " ORDER BY date DESC, start_time DESC"
        rows = conn.execute(sql, params).fetchall()
        print(json.dumps([dict(r) for r in rows], indent=2))
    return 0


def cmd_meeting_show(args) -> int:
    with open_db(readonly=True) as conn:
        ensure_schema(conn)
        row = conn.execute("SELECT * FROM meetings WHERE event_id=?",
                            (args.event_id,)).fetchone()
        if not row:
            sys.stderr.write(f"unknown event: {args.event_id}\n")
            return 1
        print(json.dumps(dict(row), indent=2))
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

    with open_db(readonly=True) as conn:
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

    with open_db(readonly=True) as conn:
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
    print(json.dumps(out, indent=2))
    return 0


# ---- interaction subcommands ------------------------------------------------

def cmd_interaction_log(args) -> int:
    with open_db() as conn:
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
    return 0


def cmd_interaction_last(args) -> int:
    with open_db(readonly=True) as conn:
        ensure_schema(conn)
        row = conn.execute(
            "SELECT * FROM interactions WHERE person LIKE ? ORDER BY timestamp DESC LIMIT 1",
            (f"%{args.person}%",)
        ).fetchone()
        if not row:
            print(json.dumps({"person": args.person, "last_interaction": None}))
        else:
            print(json.dumps(dict(row), indent=2))
    return 0


def cmd_interaction_list(args) -> int:
    with open_db(readonly=True) as conn:
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
    return 0


# ---- helpers for week/date IDs -----------------------------------------------

def _iso_week(date_str: str | None = None) -> str:
    """Return ISO week string like '2026W19'. Uses today if no date given."""
    d = datetime.strptime(date_str, "%Y-%m-%d").date() if date_str else date.today()
    return f"{d.isocalendar()[0]}W{d.isocalendar()[1]:02d}"


def _today_str() -> str:
    return date.today().isoformat()


# ---- objective subcommands ---------------------------------------------------

def cmd_objective_set(args) -> int:
    """Set a weekly objective (rank 1-3)."""
    week = args.week or _iso_week()
    obj_id = f"OBJ-{week}-{args.rank}"
    status = args.status or "proposed"
    if status not in OBJECTIVE_STATUSES:
        sys.stderr.write(f"invalid status: {status} (choose from {OBJECTIVE_STATUSES})\n")
        return 1
    with open_db() as conn:
        ensure_schema(conn)
        conn.execute("""
            INSERT INTO objectives (id, week, rank, title, outcome, category, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title=excluded.title,
                outcome=excluded.outcome,
                category=excluded.category,
                status=excluded.status
        """, (obj_id, week, args.rank, args.title, args.outcome, args.category, status))
        conn.commit()
        if not args.no_render:
            do_render(conn)
    print(json.dumps({"id": obj_id, "week": week, "rank": args.rank,
                       "title": args.title, "status": status}))
    return 0


def cmd_objective_list(args) -> int:
    """List objectives for a given week (default: current)."""
    week = args.week or _iso_week()
    with open_db(readonly=True) as conn:
        ensure_schema(conn)
        try:
            sql = "SELECT * FROM objectives WHERE week=?"
            params: list = [week]
            if args.status:
                sql += " AND status=?"
                params.append(args.status)
            sql += " ORDER BY rank"
            rows = conn.execute(sql, params).fetchall()
        except sqlite3.OperationalError:
            rows = []
        print(json.dumps([dict(r) for r in rows], indent=2))
    return 0


def _tag_things3_task(things3_uuid: str, tag: str) -> None:
    """Add a tag to a Things 3 task by UUID. Silent on failure."""
    if not THINGS3_UPDATE.exists():
        return
    try:
        subprocess.run([str(THINGS3_UPDATE), things3_uuid, "--tags", tag],
                       capture_output=True, text=True, timeout=10)
    except Exception:
        pass


def cmd_objective_link(args) -> int:
    """Link a task (commitment) to an objective."""
    with open_db() as conn:
        ensure_schema(conn)
        obj = conn.execute("SELECT id FROM objectives WHERE id=?", (args.objective_id,)).fetchone()
        if not obj:
            sys.stderr.write(f"objective not found: {args.objective_id}\n")
            return 1
        row = conn.execute(
            "SELECT task_id, things3_uuid FROM commitments WHERE task_id=?", (args.task_id,)).fetchone()
        if not row:
            sys.stderr.write(f"task not found: {args.task_id}\n")
            return 1
        conn.execute("""
            INSERT OR IGNORE INTO objective_tasks (objective_id, task_id) VALUES (?, ?)
        """, (args.objective_id, args.task_id))
        conn.commit()
        if row["things3_uuid"]:
            _tag_things3_task(row["things3_uuid"], "objective")
    print(json.dumps({"linked": args.objective_id, "task": args.task_id}))
    return 0


def cmd_objective_complete(args) -> int:
    """Mark an objective as completed."""
    with open_db() as conn:
        ensure_schema(conn)
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        cur = conn.execute(
            "UPDATE objectives SET status='completed', completed_at=? WHERE id=? AND status IN ('active','proposed')",
            (now, args.id))
        conn.commit()
        if cur.rowcount == 0:
            sys.stderr.write(f"objective not found or already completed/dropped: {args.id}\n")
            return 1
        if not args.no_render:
            do_render(conn)
    print(json.dumps({"completed": args.id}))
    return 0


def cmd_objective_score(args) -> int:
    """Score a week's objectives. Returns summary with completion count."""
    week = args.week or _iso_week()
    with open_db(readonly=True) as conn:
        ensure_schema(conn)
        rows = conn.execute(
            "SELECT * FROM objectives WHERE week=? ORDER BY rank", (week,)).fetchall()
        if not rows:
            print(json.dumps({"week": week, "score": "0/0", "objectives": []}))
            return 0
        completed = sum(1 for r in rows if r["status"] == "completed")
        total = len(rows)
        result = {
            "week": week,
            "score": f"{completed}/{total}",
            "objectives": [dict(r) for r in rows],
        }
        print(json.dumps(result, indent=2))
    return 0


def cmd_objective_carry(args) -> int:
    """Carry incomplete objectives from prior week to current week."""
    prior_week = args.from_week or _iso_week(
        (date.today() - timedelta(days=7)).isoformat())
    new_week = args.to_week or _iso_week()
    with open_db() as conn:
        ensure_schema(conn)
        rows = conn.execute(
            "SELECT * FROM objectives WHERE week=? AND status='active' ORDER BY rank",
            (prior_week,)).fetchall()
        carried = []
        for i, row in enumerate(rows, 1):
            if i > 3:
                break
            new_id = f"OBJ-{new_week}-{i}"
            conn.execute(
                "UPDATE objectives SET status='carried' WHERE id=?", (row["id"],))
            conn.execute("""
                INSERT INTO objectives (id, week, rank, title, outcome, category, status)
                VALUES (?, ?, ?, ?, ?, ?, 'proposed')
                ON CONFLICT(id) DO UPDATE SET title=excluded.title, outcome=excluded.outcome,
                    category=excluded.category, status='proposed'
            """, (new_id, new_week, i, row["title"], row["outcome"], row["category"]))
            carried.append({"old_id": row["id"], "new_id": new_id, "title": row["title"]})
        conn.commit()
        if not args.no_render:
            do_render(conn)
    print(json.dumps({"carried": carried}, indent=2))
    return 0


# ---- MIT subcommands ---------------------------------------------------------

def cmd_mit_set(args) -> int:
    """Set a daily MIT (rank 1-3)."""
    d = args.date or _today_str()
    mit_id = f"MIT-{d}-{args.rank}"
    with open_db() as conn:
        ensure_schema(conn)
        conn.execute("""
            INSERT INTO daily_mits (id, date, rank, objective_id, task_id, title)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                objective_id=excluded.objective_id,
                task_id=excluded.task_id,
                title=excluded.title,
                status='active',
                completed_at=NULL
        """, (mit_id, d, args.rank, args.objective_id, args.task_id, args.title))
        conn.commit()
        if args.task_id:
            row = conn.execute(
                "SELECT things3_uuid FROM commitments WHERE task_id=?", (args.task_id,)).fetchone()
            if row and row["things3_uuid"]:
                _tag_things3_task(row["things3_uuid"], "mit")
        if not args.no_render:
            do_render(conn)
    print(json.dumps({"id": mit_id, "date": d, "rank": args.rank,
                       "title": args.title}))
    return 0


def cmd_mit_list(args) -> int:
    """List MITs for a given date (default: today)."""
    d = args.date or _today_str()
    with open_db(readonly=True) as conn:
        ensure_schema(conn)
        try:
            rows = conn.execute(
                "SELECT * FROM daily_mits WHERE date=? ORDER BY rank", (d,)).fetchall()
        except sqlite3.OperationalError:
            rows = []
        print(json.dumps([dict(r) for r in rows], indent=2))
    return 0


def cmd_mit_complete(args) -> int:
    """Mark a MIT as completed."""
    with open_db() as conn:
        ensure_schema(conn)
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        cur = conn.execute(
            "UPDATE daily_mits SET status='completed', completed_at=? WHERE id=? AND status='active'",
            (now, args.id))
        conn.commit()
        if cur.rowcount == 0:
            sys.stderr.write(f"MIT not found or already completed: {args.id}\n")
            return 1
        if not args.no_render:
            do_render(conn)
    print(json.dumps({"completed": args.id}))
    return 0


def cmd_mit_score(args) -> int:
    """Score a day's MITs. Returns summary with completion count."""
    d = args.date or _today_str()
    with open_db(readonly=True) as conn:
        ensure_schema(conn)
        rows = conn.execute(
            "SELECT * FROM daily_mits WHERE date=? ORDER BY rank", (d,)).fetchall()
        if not rows:
            print(json.dumps({"date": d, "score": "0/0", "mits": []}))
            return 0
        completed = sum(1 for r in rows if r["status"] == "completed")
        total = len(rows)
        result = {
            "date": d,
            "score": f"{completed}/{total}",
            "mits": [dict(r) for r in rows],
        }
        print(json.dumps(result, indent=2))
    return 0


# ---- sync things 3 ----------------------------------------------------------

# Channel-to-tag map: prefer config, fall back to defaults
CHANNEL_TAG_MAP = CHANNEL_TAG_MAP_CFG or {
    "email": "MS-Email",
    "outlook-work": "MS-Email",
    "outlook-personal": "Personal-Email",
    "gmail": "Personal-Email",
    "teams": "Teams",
    "meeting": "Teams",
}

# Reverse map: Things 3 area name -> category
AREA_CATEGORY_MAP = {v: k for k, v in CATEGORY_AREA_MAP.items()}

THINGS3_UPDATE = ASSISTANT_ROOT / "things3" / "update.sh"


def decode_things3_date(packed: int | None) -> str | None:
    """Decode Things 3 packed date integer to YYYY-MM-DD string."""
    if packed is None:
        return None
    year = packed >> 16
    month = (packed >> 12) & 0xF
    day = ((packed >> 8) & 0xF) * 2 + (1 if packed & 0x80 else 0)
    if year < 2000 or month < 1 or month > 12 or day < 1 or day > 31:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def stamp_things3_task(uuid: str, task_id: str, existing_notes: str | None) -> bool:
    """Write the atlas task_id back into a Things 3 task's notes via update.sh."""
    if not THINGS3_UPDATE.exists():
        sys.stderr.write("things3/update.sh not found, skipping stamp\n")
        return False
    tag_line = f"Task ID: {task_id}"
    if existing_notes:
        new_notes = f"{existing_notes}\n{tag_line}"
    else:
        new_notes = tag_line
    try:
        result = subprocess.run(
            [str(THINGS3_UPDATE), uuid, "--notes", new_notes],
            capture_output=True, text=True, timeout=10,
        )
        return result.returncode == 0
    except Exception as e:
        sys.stderr.write(f"things3 stamp failed: {e}\n")
        return False


def push_to_things3(title: str, task_id: str, direction: str,
                    person: str | None, due: str | None,
                    category: str | None, channel: str | None,
                    notes: str | None) -> bool:
    """Push a task to Things 3 via add.sh. Returns True on success."""
    if not THINGS3_ADD.exists():
        sys.stderr.write("things3/add.sh not found, skipping push\n")
        return False

    cmd = [str(THINGS3_ADD), title, "--task-id", task_id]

    # Map category to Things 3 area
    if category and category in CATEGORY_AREA_MAP:
        cmd.extend(["--area", CATEGORY_AREA_MAP[category]])

    if due and due != "ASAP":
        cmd.extend(["--deadline", due])

    # Build tags: 'waiting' for direction=theirs, source channel tag
    tags = []
    if direction == "theirs":
        tags.append("waiting")
    if channel and channel.lower() in CHANNEL_TAG_MAP:
        tags.append(CHANNEL_TAG_MAP[channel.lower()])
    if tags:
        cmd.extend(["--tags", ",".join(tags)])

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
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            sys.stderr.write(f"things3 push exit {result.returncode}: {result.stderr.strip()}\n")
            return False
        return True
    except Exception as e:
        sys.stderr.write(f"things3 push failed: {e}\n")
        return False


def cmd_sync_things3(args) -> int:
    """Two-way sync with Things 3: pull completions AND import new tasks."""
    if not THINGS3_DB.exists():
        sys.stderr.write(f"Things 3 DB not found: {THINGS3_DB}\n")
        return 1

    dry_run = getattr(args, "dry_run", False)
    since_days = getattr(args, "since_days", None)

    with open_db(readonly=dry_run) as conn:
        ensure_schema(conn)

        # Connect to Things 3 DB (read-only)
        t3uri = f"file:{THINGS3_DB}?mode=ro"
        t3 = sqlite3.connect(t3uri, uri=True)
        t3.row_factory = sqlite3.Row

        synced = 0
        imported = 0

        # --- Phase 1: Pull completions from Things 3 ---

        # 1a. For commitments with things3_uuid: check completion status
        rows = conn.execute(
            "SELECT task_id, things3_uuid FROM commitments "
            "WHERE things3_uuid IS NOT NULL AND status='active'"
        ).fetchall()
        for r in rows:
            t3row = t3.execute(
                "SELECT status FROM TMTask WHERE uuid=?", (r["things3_uuid"],)
            ).fetchone()
            if t3row and t3row["status"] == 3:  # 3 = completed in Things 3
                if dry_run:
                    sys.stderr.write(f"  [dry-run] would complete: {r['task_id']}\n")
                else:
                    conn.execute(
                        "UPDATE commitments SET status='completed', "
                        "completed_at=date('now','localtime') WHERE task_id=?",
                        (r["task_id"],)
                    )
                synced += 1

        # 1b. For commitments without things3_uuid: try to match by Task ID in notes
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
                if dry_run:
                    label = "link+complete" if t3row["status"] == 3 else "link"
                    sys.stderr.write(f"  [dry-run] would {label}: {r['task_id']}\n")
                    if t3row["status"] == 3:
                        synced += 1
                else:
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

        # --- Phase 2: Import new tasks from Things 3 ---

        # Get all known Things 3 UUIDs already in commitments
        known = {row[0] for row in conn.execute(
            "SELECT things3_uuid FROM commitments WHERE things3_uuid IS NOT NULL"
        ).fetchall()}

        # Build creation-date filter: Things 3 uses Unix timestamps
        created_after = ""
        if since_days is not None:
            cutoff = datetime.now().timestamp() - (since_days * 86400)
            created_after = f" AND t.creationDate >= {cutoff}"

        # Query open Things 3 tasks that:
        #  - are type=0 (todo, not project/heading)
        #  - are not trashed
        #  - are open (status=0)
        #  - don't already have a Task ID in notes
        new_tasks = t3.execute(
            "SELECT t.uuid, t.title, t.notes, t.deadline, t.creationDate, "
            "  COALESCE(a.title, pa.title) AS area_name, "
            "  COALESCE(p.title, '') AS project_name "
            "FROM TMTask t "
            "LEFT JOIN TMTask p ON t.project = p.uuid "
            "LEFT JOIN TMArea a ON t.area = a.uuid "
            "LEFT JOIN TMArea pa ON p.area = pa.uuid "
            "WHERE t.type = 0 AND t.trashed = 0 AND t.status = 0 "
            "  AND (t.notes IS NULL OR t.notes NOT LIKE '%Task ID: AI-%') "
            f"{created_after} "
            "ORDER BY t.creationDate DESC"
        ).fetchall()

        batch_counter = 0
        for t in new_tasks:
            if t["uuid"] in known:
                continue

            category = AREA_CATEGORY_MAP.get(t["area_name"])
            deadline = decode_things3_date(t["deadline"])
            created = datetime.fromtimestamp(t["creationDate"]).strftime("%Y-%m-%d") if t["creationDate"] else "?"

            if dry_run:
                cat_label = category or "(no area)"
                sys.stderr.write(
                    f"  [dry-run] would import: {t['title'][:60]}"
                    f"  | area={t['area_name'] or '(none)'} -> {cat_label}"
                    f"  | deadline={deadline or '(none)'}"
                    f"  | created={created}\n"
                )
                imported += 1
                continue

            # Generate unique task_id with sub-second counter
            batch_counter += 1
            task_id = f"AI-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{batch_counter:03d}"

            conn.execute(
                "INSERT INTO commitments "
                "(task_id, things3_uuid, title, direction, category, "
                "due_date, source, status) "
                "VALUES (?, ?, ?, 'mine', ?, ?, 'things3', 'active')",
                (task_id, t["uuid"], t["title"], category, deadline)
            )

            # Stamp the Task ID back into Things 3 notes
            stamp_things3_task(t["uuid"], task_id, t["notes"])
            known.add(t["uuid"])
            imported += 1

        if not dry_run:
            conn.commit()
        t3.close()

        if not dry_run and (synced > 0 or imported > 0) and not args.no_render:
            do_render(conn)

        print(json.dumps({
            "synced_completions": synced,
            "imported_from_things3": imported,
            "dry_run": dry_run,
        }))
    return 0


# ---- render command ----------------------------------------------------------

def cmd_render(args) -> int:
    with open_db() as conn:
        ensure_schema(conn)
        do_render(conn)
        print("rendered: action-items.md, waiting-on-others.md, objectives.md")
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
    with open_db() as conn:
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

    with open_db() as conn:
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
    return 0


# ---- dump --------------------------------------------------------------------

def cmd_dump(args) -> int:
    """Export full DB to JSON for backup/debugging."""
    with open_db(readonly=True) as conn:
        ensure_schema(conn)
        data = {
            "exported_at": datetime.now().isoformat(),
            "commitments": [dict(r) for r in conn.execute("SELECT * FROM commitments ORDER BY created_at").fetchall()],
            "meetings": [dict(r) for r in conn.execute("SELECT * FROM meetings ORDER BY date DESC").fetchall()],
            "interactions": [dict(r) for r in conn.execute("SELECT * FROM interactions ORDER BY timestamp DESC").fetchall()],
            "objectives": [dict(r) for r in conn.execute("SELECT * FROM objectives ORDER BY week DESC, rank").fetchall()],
            "objective_tasks": [dict(r) for r in conn.execute("SELECT * FROM objective_tasks").fetchall()],
            "daily_mits": [dict(r) for r in conn.execute("SELECT * FROM daily_mits ORDER BY date DESC, rank").fetchall()],
        }
        print(json.dumps(data, indent=2))
    return 0


def cmd_metrics(args) -> int:
    """Retrospective metrics for a date range."""
    from datetime import timedelta
    today = datetime.now().date()
    end = datetime.strptime(args.until, "%Y-%m-%d").date() if getattr(args, "until", None) else today
    if getattr(args, "since", None):
        start = datetime.strptime(args.since, "%Y-%m-%d").date()
    else:
        start = end - timedelta(days=args.days)

    s, e = start.isoformat(), end.isoformat()

    with open_db(readonly=True) as conn:
        ensure_schema(conn)

        # Commitments completed in range
        completed = conn.execute(
            "SELECT * FROM commitments WHERE status='completed' "
            "AND completed_at >= ? AND completed_at <= ? ORDER BY completed_at",
            (s, e + "T23:59:59")
        ).fetchall()

        # Commitments created in range
        created = conn.execute(
            "SELECT * FROM commitments WHERE created_at >= ? AND created_at <= ? ORDER BY created_at",
            (s, e + "T23:59:59")
        ).fetchall()

        # Currently overdue
        overdue = conn.execute(
            "SELECT * FROM commitments WHERE status='active' AND direction='mine' "
            "AND due_date IS NOT NULL AND due_date < ? ORDER BY due_date",
            (today.isoformat(),)
        ).fetchall()

        # Meetings in range
        meetings = conn.execute(
            "SELECT * FROM meetings WHERE date >= ? AND date <= ? ORDER BY date",
            (s, e)
        ).fetchall()

        # Interactions in range
        interactions = conn.execute(
            "SELECT type, COUNT(*) as cnt FROM interactions "
            "WHERE timestamp >= ? AND timestamp <= ? GROUP BY type ORDER BY cnt DESC",
            (s, e + "T23:59:59")
        ).fetchall()

        # Nudges in range
        nudged = conn.execute(
            "SELECT * FROM commitments WHERE last_nudge >= ? AND last_nudge <= ?",
            (s, e + "T23:59:59")
        ).fetchall()

        # Compute cycle time for completed items (days from created to completed)
        cycle_times = []
        for r in completed:
            if r["created_at"] and r["completed_at"]:
                c = datetime.fromisoformat(r["created_at"][:10])
                d = datetime.fromisoformat(r["completed_at"][:10])
                cycle_times.append((d - c).days)

        # By category and direction breakdowns
        completed_by_cat = {}
        for r in completed:
            cat = r["category"] or "uncategorized"
            completed_by_cat[cat] = completed_by_cat.get(cat, 0) + 1

        completed_mine = sum(1 for r in completed if r["direction"] == "mine")
        completed_theirs = sum(1 for r in completed if r["direction"] == "theirs")

        meetings_with_recap = sum(1 for m in meetings if m.get("recap_status") == "done")

    metrics = {
        "period": {"start": s, "end": e, "days": (end - start).days},
        "commitments": {
            "created": len(created),
            "completed": len(completed),
            "completed_mine": completed_mine,
            "completed_theirs": completed_theirs,
            "completed_by_category": completed_by_cat,
            "currently_overdue": len(overdue),
            "nudges_sent": len(nudged),
        },
        "cycle_time": {
            "median_days": sorted(cycle_times)[len(cycle_times) // 2] if cycle_times else None,
            "avg_days": round(sum(cycle_times) / len(cycle_times), 1) if cycle_times else None,
            "max_days": max(cycle_times) if cycle_times else None,
            "count": len(cycle_times),
        },
        "meetings": {
            "total": len(meetings),
            "with_recap": meetings_with_recap,
        },
        "interactions": {t: c for t, c in interactions},
        "overdue_items": [
            {"task_id": r["task_id"], "title": r["title"], "due": r["due_date"],
             "person": r["person"]}
            for r in overdue
        ],
    }
    print(json.dumps(metrics, indent=2))
    return 0


# ---- init --------------------------------------------------------------------

def cmd_init(args) -> int:
    with open_db() as conn:
        ensure_schema(conn)
        conn.commit()
        print(f"initialized: {DB_PATH}")
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
    s.add_argument("--category", choices=list(CATEGORIES))
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
    s.add_argument("--category", choices=list(CATEGORIES))

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
    s.add_argument("--category", choices=list(CATEGORIES))

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
    s.add_argument("--category", choices=list(CATEGORIES))
    s.add_argument("--timestamp")

    s = isub.add_parser("last", help="Last interaction with a person")
    s.add_argument("--person", required=True)

    s = isub.add_parser("list", help="List interactions")
    s.add_argument("--person")
    s.add_argument("--type", dest="type")
    s.add_argument("--category", choices=list(CATEGORIES))
    s.add_argument("--days", type=int)
    s.add_argument("--limit", type=int)

    # objective
    obj_parser = sub.add_parser("objective", help="Manage weekly objectives")
    osub = obj_parser.add_subparsers(dest="cmd", required=True)

    s = osub.add_parser("set", help="Set a weekly objective (rank 1-3)")
    s.add_argument("--title", required=True)
    s.add_argument("--rank", type=int, required=True, choices=[1, 2, 3])
    s.add_argument("--outcome", help="Measurable success criteria")
    s.add_argument("--category", choices=list(CATEGORIES))
    s.add_argument("--week", help="ISO week like 2026W19 (default: current)")
    s.add_argument("--status", choices=list(OBJECTIVE_STATUSES),
                   help="Initial status (default: proposed)")
    add_render_flag(s)

    s = osub.add_parser("list", help="List objectives for a week")
    s.add_argument("--week", help="ISO week (default: current)")
    s.add_argument("--status", choices=list(OBJECTIVE_STATUSES))

    s = osub.add_parser("link", help="Link a task to an objective")
    s.add_argument("--objective-id", dest="objective_id", required=True)
    s.add_argument("--task-id", dest="task_id", required=True)

    s = osub.add_parser("complete", help="Mark an objective as completed")
    s.add_argument("--id", required=True)
    add_render_flag(s)

    s = osub.add_parser("score", help="Score a week's objectives")
    s.add_argument("--week", help="ISO week (default: current)")

    s = osub.add_parser("carry", help="Carry incomplete objectives to next week")
    s.add_argument("--from-week", dest="from_week",
                   help="Source week (default: prior week)")
    s.add_argument("--to-week", dest="to_week",
                   help="Target week (default: current week)")
    add_render_flag(s)

    # mit
    mit_parser = sub.add_parser("mit", help="Manage daily MITs")
    mitsub = mit_parser.add_subparsers(dest="cmd", required=True)

    s = mitsub.add_parser("set", help="Set a daily MIT (rank 1-3)")
    s.add_argument("--title", required=True)
    s.add_argument("--rank", type=int, required=True, choices=[1, 2, 3])
    s.add_argument("--objective-id", dest="objective_id",
                   help="Link to a weekly objective")
    s.add_argument("--task-id", dest="task_id",
                   help="Link to a commitment/task")
    s.add_argument("--date", help="Date YYYY-MM-DD (default: today)")
    add_render_flag(s)

    s = mitsub.add_parser("list", help="List MITs for a date")
    s.add_argument("--date", help="Date YYYY-MM-DD (default: today)")

    s = mitsub.add_parser("complete", help="Mark a MIT as completed")
    s.add_argument("--id", required=True)
    add_render_flag(s)

    s = mitsub.add_parser("score", help="Score a day's MITs")
    s.add_argument("--date", help="Date YYYY-MM-DD (default: today)")

    # sync-things3
    s = sub.add_parser("sync-things3", help="Two-way sync: pull completions + import new tasks from Things 3")
    s.add_argument("--dry-run", action="store_true", help="Preview what would be synced without making changes")
    s.add_argument("--since-days", type=int, dest="since_days",
                   help="Only import Things 3 tasks created within N days (default: all)")
    add_render_flag(s)

    # render
    sub.add_parser("render", help="Re-render markdown views from DB")

    # import
    sub.add_parser("import-markdown", help="Import action-items.md and waiting-on-others.md")
    sub.add_parser("import-ledger", help="Import meeting-briefs.json into meetings table")

    # dump
    sub.add_parser("dump", help="Export full DB to JSON")

    # metrics
    s = sub.add_parser("metrics", help="Retrospective metrics for a date range")
    s.add_argument("--days", type=int, default=7, help="Look-back window in days")
    s.add_argument("--since", help="Start date YYYY-MM-DD (overrides --days)")
    s.add_argument("--until", help="End date YYYY-MM-DD (default: today)")

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
        ("objective", "set"): lambda: cmd_objective_set(args),
        ("objective", "list"): lambda: cmd_objective_list(args),
        ("objective", "link"): lambda: cmd_objective_link(args),
        ("objective", "complete"): lambda: cmd_objective_complete(args),
        ("objective", "score"): lambda: cmd_objective_score(args),
        ("objective", "carry"): lambda: cmd_objective_carry(args),
        ("mit", "set"): lambda: cmd_mit_set(args),
        ("mit", "list"): lambda: cmd_mit_list(args),
        ("mit", "complete"): lambda: cmd_mit_complete(args),
        ("mit", "score"): lambda: cmd_mit_score(args),
        ("sync-things3", None): lambda: cmd_sync_things3(args),
        ("render", None): lambda: cmd_render(args),
        ("import-markdown", None): lambda: cmd_import_markdown(args),
        ("import-ledger", None): lambda: cmd_import_ledger(args),
        ("dump", None): lambda: cmd_dump(args),
        ("metrics", None): lambda: cmd_metrics(args),
    }

    key = (args.group, getattr(args, "cmd", None))
    fn = dispatch.get(key)
    if not fn:
        ap.print_help()
        return 2
    return fn()


if __name__ == "__main__":
    sys.exit(main())
