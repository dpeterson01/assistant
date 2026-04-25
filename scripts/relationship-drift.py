#!/usr/bin/env python3
"""
relationship-drift: Flag contacts Derek hasn't interacted with recently.

Scans journals for the most recent mention of each tracked contact, then
applies tier-based thresholds to surface people who may need a check-in.
Also flags contacts with open waiting-on-others items that have gone quiet.

Usage:
  relationship-drift.py               # default thresholds
  relationship-drift.py --days 60     # look-back window for journal scan
  relationship-drift.py --json        # machine-readable output
  relationship-drift.py --markdown    # section suitable for weekly review
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

HOME = Path.home()
REPO = Path(__file__).resolve().parents[1]  # assistant/

WORK_CONTACTS = HOME / "Library/CloudStorage/OneDrive-Microsoft/01_people/contacts"
CHURCH_CONTACTS = HOME / "Library/Mobile Documents/com~apple~CloudDocs/personal/contacts"

JOURNAL_DIRS = [
    HOME / "Library/CloudStorage/OneDrive-Microsoft/journals/work",
    HOME / "Library/Mobile Documents/com~apple~CloudDocs/personal/journals",
    HOME / "Library/Mobile Documents/com~apple~CloudDocs/initiatives/hmbl/journals",
    HOME / "Library/Mobile Documents/com~apple~CloudDocs/initiatives/catholic_church/journals",
]

BRIEFING_DIR = REPO / "briefings"

ACTION_ITEMS = REPO / "context/action-items.md"
WAITING_ON = REPO / "context/waiting-on-others.md"

DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")

# Relationship tier -> days of silence before flagging
THRESHOLDS: dict[str, int] = {
    "direct-report": 7,
    "manager": 7,
    "peer": 10,
    "cross-team": 14,
    "stakeholder": 21,
}

# Contacts with these relationship values are skipped entirely.
SKIP_RELATIONSHIPS = {"skip", "inactive", ""}


# ---------------------------------------------------------------------------
# Contact loading
# ---------------------------------------------------------------------------

def load_contacts(directory: Path) -> list[dict]:
    """Load contacts from index.json and enrich with frontmatter relationship."""
    idx = directory / "index.json"
    if not idx.exists():
        return []
    try:
        data = json.loads(idx.read_text())
    except Exception:
        return []

    contacts = []
    for entry in data.get("contacts", []):
        fpath = directory / entry["file"]
        relationship = parse_relationship(fpath)
        if relationship in SKIP_RELATIONSHIPS:
            continue
        contacts.append({
            "name": entry.get("name", ""),
            "aliases": entry.get("aliases", []),
            "email": entry.get("email"),
            "file": str(fpath),
            "relationship": relationship,
        })
    return contacts


def parse_relationship(path: Path) -> str:
    """Extract the relationship field from YAML-ish frontmatter."""
    if not path.exists():
        return ""
    try:
        text = path.read_text()
    except Exception:
        return ""
    if not text.startswith("---"):
        return ""
    end = text.find("---", 3)
    if end < 0:
        return ""
    fm = text[3:end]
    for line in fm.splitlines():
        if line.strip().startswith("relationship:"):
            return line.split(":", 1)[1].strip().strip('"').strip("'")
    return ""


# ---------------------------------------------------------------------------
# Journal + briefing scanning
# ---------------------------------------------------------------------------

def dated_files(directories: list[Path], days: int) -> list[tuple[date, Path]]:
    """Return (file_date, path) for all .md files within the look-back window."""
    cutoff = date.today() - timedelta(days=days)
    out: list[tuple[date, Path]] = []
    for d in directories:
        if not d.exists():
            continue
        for p in d.glob("*.md"):
            m = DATE_RE.search(p.name)
            if not m:
                continue
            try:
                fdate = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                continue
            if fdate >= cutoff:
                out.append((fdate, p))
    out.sort(key=lambda x: x[0], reverse=True)
    return out


def build_name_pattern(name: str, aliases: list[str]) -> re.Pattern:
    """Word-boundary regex for name and multi-token aliases."""
    needles: list[str] = [name]
    for a in aliases:
        if a and len(a.split()) >= 2 and a not in needles:
            needles.append(a)
    tokens = name.split()
    if len(tokens) >= 2:
        last = tokens[-1]
        if last not in needles:
            needles.append(last)
    parts = [r"\b" + re.escape(n) + r"\b" for n in needles if n]
    if not parts:
        return re.compile(r"(?!)")  # match nothing
    return re.compile("|".join(parts), re.IGNORECASE)


def find_last_mention(
    contact: dict,
    files: list[tuple[date, Path]],
    file_cache: dict[Path, str],
) -> date | None:
    """Return the date of the most recent file mentioning this contact."""
    pattern = build_name_pattern(contact["name"], contact["aliases"])
    for fdate, fpath in files:
        if fpath not in file_cache:
            try:
                file_cache[fpath] = fpath.read_text()
            except Exception:
                file_cache[fpath] = ""
        if pattern.search(file_cache[fpath]):
            return fdate
    return None


# ---------------------------------------------------------------------------
# Open obligations
# ---------------------------------------------------------------------------

DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:3141")


def _dashboard_obligations(name: str) -> tuple[list[str], list[str]] | None:
    """Try fetching obligations from the dashboard API. Returns (waiting_on, derek_owes)
    as raw strings, or None if the dashboard is unreachable."""
    try:
        import urllib.request
        import urllib.parse
        url = f"{DASHBOARD_URL}/api/obligations?person={urllib.parse.quote(name)}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        waiting = [
            f"- [ ] {item['text']}" + (f" | {item.get('detail','')}" if item.get('detail') else "")
            for item in data.get("theyOwe", [])
        ]
        owes = [
            f"- [ ] {item['text']}" + (f" | {item.get('detail','')}" if item.get('detail') else "")
            for item in data.get("derekOwes", [])
        ]
        return waiting, owes
    except Exception:
        return None


def open_obligations(md_path: Path, name: str, aliases: list[str]) -> list[str]:
    """Return open checklist lines mentioning this person.
    Falls back to markdown parsing if the dashboard is unreachable."""
    if not md_path.exists():
        return []
    text = md_path.read_text()
    cutoff = re.search(r"^##\s+(Completed|Resolved)", text, flags=re.MULTILINE)
    active = text[: cutoff.start()] if cutoff else text
    pattern = build_name_pattern(name, aliases)
    return [
        ln.strip()
        for ln in active.splitlines()
        if ln.lstrip().startswith("- [ ]") and pattern.search(ln)
    ]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def check_drift(days: int = 45) -> list[dict]:
    """Return a list of drifting contacts, sorted by urgency."""
    contacts: list[dict] = []
    for d in (WORK_CONTACTS, CHURCH_CONTACTS):
        contacts.extend(load_contacts(d))

    all_dirs = JOURNAL_DIRS + [BRIEFING_DIR]
    files = dated_files(all_dirs, days)
    file_cache: dict[Path, str] = {}
    today = date.today()

    results: list[dict] = []
    for c in contacts:
        threshold = THRESHOLDS.get(c["relationship"])
        if threshold is None:
            continue

        last = find_last_mention(c, files, file_cache)
        gap = (today - last).days if last else days
        overdue_days = gap - threshold

        waiting = open_obligations(WAITING_ON, c["name"], c["aliases"])
        owes = open_obligations(ACTION_ITEMS, c["name"], c["aliases"])

        # Try dashboard API for fresher obligation data
        api_result = _dashboard_obligations(c["name"])
        if api_result is not None:
            waiting, owes = api_result

        if overdue_days > 0 or (waiting and gap > threshold // 2):
            results.append({
                "name": c["name"],
                "relationship": c["relationship"],
                "last_interaction": last.isoformat() if last else None,
                "days_since": gap,
                "threshold": threshold,
                "overdue_by": max(overdue_days, 0),
                "waiting_on": waiting,
                "derek_owes": owes,
            })

    # Sort: most overdue first, then by relationship tier importance.
    tier_rank = {"direct-report": 0, "manager": 0, "peer": 1, "cross-team": 2, "stakeholder": 3}
    results.sort(key=lambda r: (tier_rank.get(r["relationship"], 9), -r["overdue_by"]))
    return results


def render_markdown(results: list[dict]) -> str:
    if not results:
        return "## Relationship Drift\n\nNo flags this week. All tracked contacts have recent interactions.\n"

    lines = ["## Relationship Drift\n"]
    for r in results:
        last = r["last_interaction"] or "no record"
        gap = r["days_since"]
        name = r["name"]
        rel = r["relationship"]

        line = f"- **{name}** ({rel}) — last interaction: {last} ({gap} days ago, threshold: {r['threshold']}d)"
        if r["waiting_on"]:
            items = "; ".join(
                ln.replace("- [ ] ", "").split("|")[0].strip()
                for ln in r["waiting_on"]
            )
            line += f"\n  - Waiting on them: {items}"
        if r["derek_owes"]:
            items = "; ".join(
                ln.replace("- [ ] ", "").split("|")[0].strip()
                for ln in r["derek_owes"]
            )
            line += f"\n  - Derek owes them: {items}"
        if not r["waiting_on"] and not r["derek_owes"]:
            line += ". Consider reaching out."
        lines.append(line)

    return "\n".join(lines) + "\n"


def render_json(results: list[dict]) -> str:
    return json.dumps(results, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser(description="Detect relationship drift")
    parser.add_argument("--days", type=int, default=45, help="Journal look-back window (default: 45)")
    parser.add_argument("--json", action="store_true", help="JSON output")
    parser.add_argument("--markdown", action="store_true", help="Markdown section for weekly review")
    args = parser.parse_args()

    results = check_drift(days=args.days)

    if args.json:
        print(render_json(results))
    elif args.markdown:
        print(render_markdown(results))
    else:
        if not results:
            print("No relationship drift flags.")
            return
        for r in results:
            last = r["last_interaction"] or "no record"
            print(f"{r['name']} ({r['relationship']}): last {last}, {r['days_since']}d ago [threshold: {r['threshold']}d]")
            for w in r["waiting_on"]:
                print(f"  ⏳ waiting: {w.strip()}")
            for o in r["derek_owes"]:
                print(f"  📌 owes: {o.strip()}")


if __name__ == "__main__":
    main()
