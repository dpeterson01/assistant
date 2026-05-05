#!/usr/bin/env python3
"""
get-person-context: Aggregate everything we know about a person for draft-time context.

Pulls:
  1. Contact file (work or church directory) via index.json alias resolution
  2. Open items the user owes them (action-items.md)
  3. Open items they owe the user (waiting-on-others.md)
  4. Recent journal mentions across configured journals (work / personal / additional contexts)

Usage:
  get-person-context.py "Jane Smith"
  get-person-context.py jane --days 60
  get-person-context.py heather --json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

HOME = Path.home()
REPO = Path(__file__).resolve().parents[1]  # assistant/

def _load_config() -> dict:
    """Load data/config.yaml; return empty dict if missing or unparseable."""
    config_path = REPO / "data/config.yaml"
    if not config_path.exists():
        return {}
    try:
        import yaml  # pylint: disable=import-outside-toplevel
        with open(config_path) as fh:
            return yaml.safe_load(fh) or {}
    except Exception:
        return {}


def _journal_dirs_from_config(config: dict) -> list[tuple[str, Path]]:
    """Derive (context, directory) pairs from config journals section."""
    result = []
    for ctx, pattern in config.get("journals", {}).items():
        expanded = os.path.expanduser(pattern)
        dir_path = Path(expanded).parent
        while "%" in dir_path.name:
            dir_path = dir_path.parent
        result.append((ctx, dir_path))
    return result


def _contact_dir(config: dict, key: str, fallback: Path) -> Path:
    """Resolve a contacts path from config; return directory."""
    raw = config.get("contacts", {}).get(key, "")
    if not raw:
        return fallback
    p = Path(os.path.expanduser(raw))
    return p.parent if p.suffix == ".json" else p


_CFG = _load_config()
WORK_CONTACTS = _contact_dir(_CFG, "work", HOME / "Documents/contacts/work")
CHURCH_CONTACTS = _contact_dir(_CFG, "community", HOME / "Documents/contacts/personal")
JOURNAL_DIRS = _journal_dirs_from_config(_CFG) or [
    ("work", HOME / "Documents/journals/work"),
    ("personal", HOME / "Documents/journals/personal"),
]

ACTION_ITEMS = REPO / "data/context/action-items.md"
WAITING_ON = REPO / "data/context/waiting-on-others.md"


# ----- contact resolution -----------------------------------------------------

def load_index(directory: Path) -> list[dict]:
    idx = directory / "index.json"
    if not idx.exists():
        return []
    try:
        data = json.loads(idx.read_text())
        return data.get("contacts", [])
    except Exception:
        return []


class AmbiguousQuery(Exception):
    def __init__(self, candidates: list[dict]):
        self.candidates = candidates
        super().__init__(
            "Ambiguous query. Candidates: "
            + ", ".join(c.get("name", "?") for c in candidates)
        )


def resolve_by_email(email: str) -> tuple[Path | None, dict | None]:
    """Resolve a contact strictly by email address. Returns (None, None) if no
    contact has that email. Zero-ambiguity path for callers that have it.
    """
    e = email.strip().lower()
    if not e:
        return None, None
    for directory in (WORK_CONTACTS, CHURCH_CONTACTS):
        for c in load_index(directory):
            if (c.get("email") or "").strip().lower() == e:
                return directory / c["file"], c
    return None, None


def resolve_contact(query: str) -> tuple[Path, dict] | tuple[None, None]:
    """Return (file_path, index_entry) for the best-matching contact, or (None, None).

    Raises AmbiguousQuery when the query matches multiple distinct contacts and
    cannot be disambiguated automatically.
    """
    q = query.strip().lower()
    for directory in (WORK_CONTACTS, CHURCH_CONTACTS):
        contacts = load_index(directory)
        # Pass 1: exact name / alias / email (case-insensitive). Always wins.
        for c in contacts:
            names = [c.get("name", "")] + c.get("aliases", []) + (
                [c.get("email", "")] if c.get("email") else []
            )
            if any(n.lower() == q for n in names if n):
                return directory / c["file"], c

        # Pass 2: first-name token match. If exactly one contact has this first
        # name (or alias first token), it's unambiguous.
        first_matches = []
        for c in contacts:
            tokens = [c.get("name", "")] + c.get("aliases", [])
            firsts = {t.split(" ")[0].lower() for t in tokens if t}
            if q in firsts:
                first_matches.append(c)
        if len(first_matches) == 1:
            c = first_matches[0]
            return directory / c["file"], c
        if len(first_matches) > 1:
            raise AmbiguousQuery(first_matches)

        # Pass 3: substring on name / alias. Only accept if exactly one match.
        sub_matches = []
        for c in contacts:
            names = [c.get("name", "")] + c.get("aliases", [])
            if any(q in n.lower() for n in names if n):
                sub_matches.append(c)
        if len(sub_matches) == 1:
            c = sub_matches[0]
            return directory / c["file"], c
        if len(sub_matches) > 1:
            raise AmbiguousQuery(sub_matches)
    return None, None


# ----- obligation extraction --------------------------------------------------

DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:3141")


def _dashboard_obligations(person_name: str) -> tuple[list[str], list[str]] | None:
    """Try fetching obligations from the dashboard API. Returns (user_owes, they_owe)
    as formatted strings, or None if the dashboard is unreachable."""
    try:
        import urllib.request
        import urllib.parse
        url = f"{DASHBOARD_URL}/api/obligations?person={urllib.parse.quote(person_name)}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        user_owes = [
            f"- [ ] {item['text']}" + (f" | {item['detail']}" if item.get('detail') else "")
            for item in data.get("userOwes", [])
        ]
        they_owe = [
            f"- [ ] {item['text']}" + (f" | {item['detail']}" if item.get('detail') else "")
            for item in data.get("theyOwe", [])
        ]
        return user_owes, they_owe
    except Exception:
        return None


def extract_open_items(
    md_path: Path,
    person_name: str,
    aliases: list[str],
    first_name_unique: bool,
) -> list[str]:
    """Return open checklist lines from the Active section that mention the person.
    Falls back to markdown parsing if the dashboard is unreachable."""
    if not md_path.exists():
        return []
    text = md_path.read_text()
    # Take everything up to "## Completed" or "## Resolved"
    cutoff = re.search(r"^##\s+(Completed|Resolved)", text, flags=re.MULTILINE)
    active = text[: cutoff.start()] if cutoff else text

    pattern = build_name_pattern(person_name, aliases, first_name_unique)

    hits = []
    for line in active.splitlines():
        if line.lstrip().startswith("- [ ]") and pattern.search(line):
            hits.append(line.strip())
    return hits


def build_name_pattern(
    person_name: str,
    aliases: list[str],
    first_name_unique: bool,
) -> re.Pattern:
    """Word-boundary regex for full name, aliases, last name, and (if unique
    across the index) first name. Word boundaries prevent substring false
    positives like 'Jane' matching 'Janelle'.
    """
    needles: list[str] = [person_name]
    # Multi-token aliases are unambiguous; single-token aliases are gated.
    multi_token_aliases = [a for a in aliases if a and len(a.split()) >= 2]
    for n in multi_token_aliases:
        if n not in needles:
            needles.append(n)
    tokens = person_name.split(" ")
    if len(tokens) >= 2:
        last = tokens[-1]
        if last and last not in needles:
            needles.append(last)
    if first_name_unique and tokens:
        first = tokens[0]
        if first and first not in needles:
            needles.append(first)
    parts = [r"\b" + re.escape(n) + r"\b" for n in needles if n]
    return re.compile("|".join(parts), re.IGNORECASE)


# ----- co-occurrence -----------------------------------------------------------

PROPER_PHRASE_RE = re.compile(r"\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+\b")
# Phrases here are too generic to count as associate signal even though they
# look like proper nouns in markdown.
ASSOCIATE_STOPLIST = {
    "Open Threads",
    "What I Did",
    "Working Style",
    "Communications Summary",
    "Last Nudge",
    "Connects Signals",
    "Recent Journal Mentions",
    "Person Context",
    "Contact Card",
}


def extract_associates(contact_md: str, person_name: str) -> set[str]:
    """Return multi-word proper-noun phrases from the contact card (people,
    teams, initiatives this person co-occurs with). Excludes the person
    themselves and a small stoplist of generic markdown headings.
    """
    if not contact_md:
        return set()
    found = set(PROPER_PHRASE_RE.findall(contact_md))
    found = {p for p in found if p not in ASSOCIATE_STOPLIST}
    # Drop the person and any phrase that contains their last name (avoids
    # treating their own full name or 'Jane Smith 1:1' as an associate).
    last = person_name.split(" ")[-1].lower() if person_name else ""
    drop = set()
    for p in found:
        pl = p.lower()
        if pl == person_name.lower():
            drop.add(p)
        elif last and last in pl.split():
            drop.add(p)
    return found - drop


def count_associate_hits(text: str, associates: set[str]) -> int:
    """How many distinct associate phrases appear in `text` (word-bounded)."""
    if not associates:
        return 0
    hits = 0
    for a in associates:
        if re.search(r"\b" + re.escape(a) + r"\b", text):
            hits += 1
    return hits


# ----- journal mining ---------------------------------------------------------

DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def journal_files_within(days: int) -> list[tuple[str, Path]]:
    cutoff = date.today() - timedelta(days=days)
    out = []
    for label, d in JOURNAL_DIRS:
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
                out.append((label, p))
    out.sort(key=lambda x: x[1].name, reverse=True)
    return out


def find_mentions(
    path: Path,
    person_name: str,
    aliases: list[str],
    first_name_unique: bool,
    associates: set[str] | None = None,
    cooccurrence_threshold: int = 2,
    context_lines: int = 1,
) -> list[dict]:
    """Return a list of {confidence, snippet} dicts.

    Strong matches (full name, last name, multi-token aliases) are always
    returned with confidence='strong'. Bare first-name matches are returned
    with confidence='co-occurrence' only when the file contains at least
    `cooccurrence_threshold` known associates of this person (extracted from
    their contact card). Otherwise bare first-name lines are dropped.
    """
    try:
        lines = path.read_text().splitlines()
    except Exception:
        return []

    tokens = person_name.split(" ")
    multi_token_aliases = [a for a in aliases if a and len(a.split()) >= 2]
    strong_needles: list[str] = [person_name] + multi_token_aliases
    if len(tokens) >= 2 and tokens[-1] not in strong_needles:
        strong_needles.append(tokens[-1])
    if first_name_unique and len(tokens) < 2 and tokens and tokens[0] not in strong_needles:
        # Mononym (single-token) contacts: bare token IS the strong match.
        strong_needles.append(tokens[0])
    strong_pat = re.compile(
        "|".join(r"\b" + re.escape(n) + r"\b" for n in strong_needles if n),
        re.IGNORECASE,
    )

    # Co-occurrence pattern: bare first name, only used for multi-token contacts.
    weak_pat = None
    if len(tokens) >= 2 and tokens[0]:
        weak_pat = re.compile(r"\b" + re.escape(tokens[0]) + r"\b", re.IGNORECASE)

    file_text = "\n".join(lines)
    associate_hits = count_associate_hits(file_text, associates or set())
    cooccurrence_supported = associate_hits >= cooccurrence_threshold

    results: list[dict] = []
    seen: set[tuple[int, int]] = set()

    def add(i: int, confidence: str) -> None:
        start = max(0, i - context_lines)
        end = min(len(lines), i + context_lines + 1)
        key = (start, end)
        if key in seen:
            return
        seen.add(key)
        results.append({
            "confidence": confidence,
            "snippet": "\n".join(lines[start:end]).strip(),
        })

    for i, line in enumerate(lines):
        if strong_pat.search(line):
            add(i, "strong")
        elif weak_pat and cooccurrence_supported and weak_pat.search(line):
            # Only attribute bare first-name hits when the file has independent
            # corroboration (>= threshold associates of this person).
            add(i, "co-occurrence")

    return results


# ----- main -------------------------------------------------------------------

def is_first_name_unique(person_name: str, contact_dirs=(WORK_CONTACTS, CHURCH_CONTACTS)) -> bool:
    """True iff this person's first name maps to exactly one contact across the
    combined work + church indexes.
    """
    first = person_name.split(" ")[0].lower()
    if not first:
        return False
    matches = 0
    for d in contact_dirs:
        for c in load_index(d):
            tokens = [c.get("name", "")] + c.get("aliases", [])
            firsts = {t.split(" ")[0].lower() for t in tokens if t}
            if first in firsts:
                matches += 1
                if matches > 1:
                    return False
    return matches == 1


def build_brief(
    query: str,
    days: int,
    email: str | None = None,
    max_per_file: int = 3,
    max_total: int = 15,
) -> dict:
    contact_path: Path | None = None
    entry: dict | None = None

    # Email-first resolution (zero ambiguity when available).
    if email:
        contact_path, entry = resolve_by_email(email)

    if contact_path is None:
        try:
            contact_path, entry = resolve_contact(query)
        except AmbiguousQuery as e:
            return {
                "query": query,
                "error": (
                    f"Ambiguous query '{query}'. Candidates: "
                    + ", ".join(c.get("name", "?") for c in e.candidates)
                    + ". Re-run with the full name or --email."
                ),
                "candidates": [c.get("name") for c in e.candidates],
            }

    if not contact_path or not entry:
        # New-contact stub: emit a usable brief instead of erroring out.
        return {
            "name": query,
            "email": email,
            "new_contact": True,
            "contact_file": None,
            "contact_md": "",
            "associates": [],
            "user_owes": [],
            "they_owe": [],
            "journal_mentions": [],
            "days_window": days,
            "note": (
                "No contact card found. Treat as a new/unknown contact: "
                "research before responding and consider adding to "
                "01_people/contacts/."
            ),
        }

    name = entry.get("name", query)
    aliases = entry.get("aliases", [])
    contact_md = contact_path.read_text() if contact_path.exists() else ""
    first_unique = is_first_name_unique(name)
    associates = extract_associates(contact_md, name)

    # Try dashboard API first, fall back to markdown parsing
    api_result = _dashboard_obligations(name)
    if api_result is not None:
        user_owes, they_owe = api_result
    else:
        user_owes = extract_open_items(ACTION_ITEMS, name, aliases, first_unique)
        they_owe = extract_open_items(WAITING_ON, name, aliases, first_unique)

    journal_hits = []
    total = 0
    for label, jpath in journal_files_within(days):
        if total >= max_total:
            break
        mentions = find_mentions(jpath, name, aliases, first_unique, associates=associates)
        if not mentions:
            continue
        # Cap per-file (most recent first as files are already sorted desc).
        mentions = mentions[:max_per_file]
        # Respect global cap across all files.
        remaining = max_total - total
        if len(mentions) > remaining:
            mentions = mentions[:remaining]
        if mentions:
            journal_hits.append({"source": label, "file": jpath.name, "mentions": mentions})
            total += len(mentions)

    return {
        "name": name,
        "aliases": aliases,
        "email": entry.get("email"),
        "new_contact": False,
        "contact_file": str(contact_path),
        "contact_md": contact_md,
        "associates": sorted(associates),
        "user_owes": user_owes,
        "they_owe": they_owe,
        "journal_mentions": journal_hits,
        "days_window": days,
    }


def render_markdown(brief: dict) -> str:
    if brief.get("error"):
        return f"# Person Context\n\n**Error:** {brief['error']}\n"
    if brief.get("new_contact"):
        email_line = f" · email: `{brief['email']}`" if brief.get("email") else ""
        return (
            f"# Person Context: {brief['name']} _(new contact)_\n"
            f"_Window: last {brief['days_window']} days{email_line}_\n\n"
            f"> {brief.get('note', '').strip()}\n"
        )
    parts = [f"# Person Context: {brief['name']}",
             f"_Window: last {brief['days_window']} days · contact: `{brief['contact_file']}`_\n"]

    parts.append("## Contact Card\n")
    parts.append(brief["contact_md"].strip() or "_(empty)_")

    parts.append("\n## Open: the user Owes Them")
    parts.append("\n".join(brief["user_owes"]) if brief["user_owes"] else "_None._")

    parts.append("\n## Open: They Owe the user")
    parts.append("\n".join(brief["they_owe"]) if brief["they_owe"] else "_None._")

    parts.append("\n## Recent Journal Mentions")
    if not brief["journal_mentions"]:
        parts.append("_No mentions in window._")
    else:
        for entry in brief["journal_mentions"]:
            parts.append(f"\n### {entry['source']} / {entry['file']}")
            for m in entry["mentions"]:
                tag = "" if m["confidence"] == "strong" else " _(co-occurrence; verify)_"
                snippet = m["snippet"].replace(chr(10), chr(10) + "> ")
                parts.append(f">{tag}\n> {snippet}")

    return "\n".join(parts) + "\n"


def _xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def render_xml(brief: dict) -> str:
    """Emit a tagged context block suitable for embedding in an LLM prompt.
    All free-text from contact cards / journals is wrapped in tags marked as
    untrusted so downstream prompts can apply hardening.
    """
    if brief.get("error"):
        return f"<person_context error=\"{_xml_escape(brief['error'])}\" />"

    if brief.get("new_contact"):
        email = _xml_escape(brief.get("email") or "")
        return (
            f"<person_context new_contact=\"true\" name=\"{_xml_escape(brief['name'])}\" "
            f"email=\"{email}\">\n"
            f"  <note>{_xml_escape(brief.get('note', ''))}</note>\n"
            f"</person_context>\n"
        )

    out = [f"<person_context name=\"{_xml_escape(brief['name'])}\" days=\"{brief['days_window']}\">"]
    if brief.get("email"):
        out.append(f"  <email>{_xml_escape(brief['email'])}</email>")
    out.append("  <contact_card trust=\"trusted\">")
    out.append(_xml_escape(brief["contact_md"].strip()))
    out.append("  </contact_card>")

    out.append("  <user_owes_them>")
    for line in brief["user_owes"]:
        out.append(f"    <item>{_xml_escape(line)}</item>")
    out.append("  </user_owes_them>")

    out.append("  <they_owe_user>")
    for line in brief["they_owe"]:
        out.append(f"    <item>{_xml_escape(line)}</item>")
    out.append("  </they_owe_user>")

    out.append("  <journal_mentions trust=\"untrusted\">")
    for entry in brief["journal_mentions"]:
        for m in entry["mentions"]:
            out.append(
                f"    <mention source=\"{_xml_escape(entry['source'])}\" "
                f"file=\"{_xml_escape(entry['file'])}\" "
                f"confidence=\"{m['confidence']}\">"
            )
            out.append(_xml_escape(m["snippet"]))
            out.append("    </mention>")
    out.append("  </journal_mentions>")
    out.append("</person_context>")
    return "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser(description="Aggregate context for a person.")
    ap.add_argument("name", nargs="?", default="",
                    help="Name, alias, first name, or email. Optional if --email is given.")
    ap.add_argument("--email", help="Resolve strictly by email address (zero ambiguity).")
    ap.add_argument("--days", type=int, default=30, help="Journal lookback window (default 30)")
    ap.add_argument("--max-per-file", type=int, default=3,
                    help="Max journal mentions per file (default 3)")
    ap.add_argument("--max-total", type=int, default=15,
                    help="Max journal mentions across all files (default 15)")
    fmt = ap.add_mutually_exclusive_group()
    fmt.add_argument("--json", action="store_true", help="Output JSON")
    fmt.add_argument("--xml", action="store_true",
                     help="Output XML-tagged block for LLM prompt embedding")
    args = ap.parse_args()

    if not args.name and not args.email:
        ap.error("provide a name argument or --email")

    brief = build_brief(
        args.name or (args.email or ""),
        args.days,
        email=args.email,
        max_per_file=args.max_per_file,
        max_total=args.max_total,
    )
    if args.json:
        print(json.dumps(brief, indent=2))
    elif args.xml:
        print(render_xml(brief))
    else:
        print(render_markdown(brief))
    # Exit 0 for normal + new-contact briefs, 2 for ambiguous, 1 for hard error.
    if brief.get("error"):
        sys.exit(2 if brief.get("candidates") else 1)
    sys.exit(0)


if __name__ == "__main__":
    main()
