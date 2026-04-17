#!/usr/bin/env python3
"""
Filter spam/marketing email entries from personal and work journal files.
Removes lines matching known spam senders or marketing subject patterns.
Dry run by default; use --apply to write changes.
"""
import os
import re
import sys
import glob

# --- CONFIGURATION ---

PERSONAL_JOURNALS = os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~CloudDocs/personal/journals"
)
WORK_JOURNALS = os.path.expanduser(
    "~/Library/CloudStorage/OneDrive-Microsoft/journals/work"
)

# Known marketing/spam senders (case-insensitive substring match on the "from" portion)
SPAM_SENDERS = [
    # Newsletters & digests
    "Morning Brew",
    "The Rundown AI",
    "Superhuman",
    "Quora Digest",
    "The Wall Street",  # WSJ Wine marketing
    "WSJ Wine",
    "ChatPRD",
    "chatprd.ai",
    "Tony Polecastro",
    "Dharmesh @ simple.ai",
    # Retail / shopping / promo
    "Harbor Freight",
    "Naked Wines",
    "Etsy",
    "Washington Huskies Online Sto",
    "Crutchfield",  # cart abandonment
    "Smile Brilliant",
    "Eureka Ergonomic",
    "Gardyn",
    "Saatva",
    "Conan Gray Official Store",
    "Monster Energy Supercross",
    "Les Schwab Tire Centers",
    "RevZilla Shipping",
    "RevZilla Customer Service",
    "REGION OFFROAD",

    "Firstleaf",
    "Lisa Jahred",  # marketing/sales
    "Disney Hawaii Ko Olina",
    "Lovable",  # marketing emails (11 total, AI tool promo)
    "Carolyn Wright",  # Morning Brew alternate sender
    "Cody Moser",  # unsolicited promo
    # Loyalty / points / rewards    "IHG One Rewards",
    "American Express",
    "American Express Global Mercha",
    # Social media notifications
    "Instagram",
    # Smart home reports (automated)
    "Nest Home Report",
    "Google Home",
    "Google Nest",
    "iRobot Customer Care",
    # Sports fantasy (automated)
    "Yahoo Sports Fantasy",
    "Yahoo Fantasy Sports",
    # Misc automated
    "EasyRoommate.com",
    "Fisher & Paykel",
    "fisherpaykel.com",
    "Yahoo Mail",
    # Work-specific newsletters
    "AX&E Product AI Newsletter",
    "Product AI Newsletter",
    "Peter Witty",  # AI newsletter author
]

# Subject-line patterns (regex, case-insensitive) that indicate marketing
SPAM_SUBJECT_PATTERNS = [
    r"\d+%\s*off",               # "25% Off", "50% off"
    r"sale\s+now",               # "Sale Now!"
    r"last\s+chance",            # "LAST CHANCE"
    r"ends\s+tonight",           # "Ends TONIGHT"
    r"spring\s+into\s+action",
    r"black\s+friday",
    r"shopping\s+cart",          # cart abandonment
    r"points?\s+expire",         # loyalty points expiration
    r"earn\s+\d+.{0,5}points",   # "earn 30,000 points"
    r"get\s+back\s+on\s+instagram",
    r"we've\s+made\s+it\s+easy",
    r"\$\d+\s+off",              # "$5 OFF"
    r"enjoy\s+\$\d+",            # "Enjoy $5"
    r"reminder.*\$\d+",          # "REMINDER: You've got $5 off"
    r"give\s+us\s+your\s+feedback",
    r"helpful\s+resources\s+inside",
]

# Compile regex patterns
SPAM_SUBJECT_RES = [re.compile(p, re.IGNORECASE) for p in SPAM_SUBJECT_PATTERNS]


def is_spam_line(line: str) -> bool:
    """Check if a bullet email line matches spam/marketing patterns."""
    stripped = line.strip()
    if not stripped.startswith("- "):
        return False

    sender = None
    subject = None

    # Format 1 - Personal (older): "- Subject text (from Sender Name)"
    from_match = re.search(r'\(from\s+(.+?)\)?\s*$', stripped)
    if from_match:
        sender = from_match.group(1)
        subject_match = re.match(r'^- (.+?)(?:\s*\(from )', stripped)
        if subject_match:
            subject = subject_match.group(1)

    # Format 2 - Personal (newer): "- from Sender: Subject"
    from_prefix_match = re.match(r'^- from\s+(.+?):\s+(.+)$', stripped)
    if from_prefix_match:
        sender = from_prefix_match.group(1)
        subject = from_prefix_match.group(2)

    # Format 3 - Work: "- **Subject** | From: Name → To: Names | Summary: text"
    work_match = re.match(r'^- \*\*(.+?)\*\*\s*\|\s*From:\s*(.+?)(?:\s*→|\s*\|)', stripped)
    if work_match:
        subject = work_match.group(1)
        sender = work_match.group(2).strip()

    # Check sender against spam list
    if sender:
        for spam_sender in SPAM_SENDERS:
            if spam_sender.lower() in sender.lower():
                return True

    # Check subject patterns
    if subject:
        for pattern in SPAM_SUBJECT_RES:
            if pattern.search(subject):
                return True

    return False


def is_email_count_line(line: str) -> bool:
    """Check if line is '- N personal emails received' summary line."""
    return bool(re.match(r'^- \d+ personal emails? received', line.strip()))


def process_file(filepath: str, apply: bool) -> dict:
    """Process a single journal file, removing spam email lines.

    Returns dict with stats: removed count, kept count, modified bool.
    """
    with open(filepath, 'r') as f:
        lines = f.readlines()

    new_lines = []
    removed = 0
    kept_emails = 0
    in_email_section = False
    email_section_start = None

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Track if we're in an email section
        if stripped.startswith("## Email") or stripped.startswith("### Email"):
            in_email_section = True
            email_section_start = len(new_lines)
            new_lines.append(line)
            continue

        # Exit email section on next header (but not sub-headers within email)
        if in_email_section and stripped.startswith("#") and not stripped.startswith("### Email") and not stripped.startswith("## Email"):
            in_email_section = False

        if in_email_section and stripped.startswith("- "):
            # Skip the "N personal emails received" count line
            if is_email_count_line(line):
                new_lines.append(line)
                continue

            if is_spam_line(line):
                removed += 1
                continue
            else:
                kept_emails += 1

        new_lines.append(line)

    modified = removed > 0

    if modified and apply:
        with open(filepath, 'w') as f:
            f.writelines(new_lines)

    return {
        'removed': removed,
        'kept': kept_emails,
        'modified': modified,
    }


def main():
    apply = '--apply' in sys.argv
    personal_only = '--personal' in sys.argv
    work_only = '--work' in sys.argv

    if not personal_only and not work_only:
        # Do both
        do_personal = True
        do_work = True
    else:
        do_personal = personal_only
        do_work = work_only

    mode = "APPLY" if apply else "DRY RUN"
    print(f"Mode: {mode}\n")

    total_removed = 0
    total_kept = 0
    files_modified = 0

    targets = []
    if do_personal:
        personal_files = sorted(glob.glob(os.path.join(PERSONAL_JOURNALS, "*.md")))
        # Exclude things3 snapshots
        personal_files = [f for f in personal_files if not os.path.basename(f).startswith("things3")]
        targets.append(("Personal journals", personal_files))

    if do_work:
        work_files = sorted(glob.glob(os.path.join(WORK_JOURNALS, "*.md")))
        targets.append(("Work journals", work_files))

    for label, files in targets:
        section_removed = 0
        section_kept = 0
        section_modified = 0

        print(f"--- {label} ({len(files)} files) ---")
        for filepath in files:
            result = process_file(filepath, apply)
            if result['modified']:
                fname = os.path.basename(filepath)
                verb = "CLEANED" if apply else "WOULD CLEAN"
                print(f"  {verb} {fname}: removed {result['removed']}, kept {result['kept']}")
                section_modified += 1
            section_removed += result['removed']
            section_kept += result['kept']

        print(f"  Subtotal: {section_removed} removed, {section_kept} kept, {section_modified} files modified\n")
        total_removed += section_removed
        total_kept += section_kept
        files_modified += section_modified

    print(f"TOTAL: {total_removed} spam/marketing lines removed, {total_kept} email lines kept, {files_modified} files modified")


if __name__ == '__main__':
    main()
