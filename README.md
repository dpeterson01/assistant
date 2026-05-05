# Assistant

Personal AI assistant framework: VS Code prompts, Things 3 scripts, dashboard, automation, and commitment tracking.

## Prerequisites

- **macOS** (tested on Sonoma/Sequoia)
- **Python 3.10+** — `python3 --version`
- **Node.js 18+** — for the dashboard (`node --version`)
- **Things 3** — task manager (Mac App Store)
- **VS Code** with GitHub Copilot Chat extension
- **PyYAML** — `pip3 install pyyaml --break-system-packages`

## Quick Start

```sh
git clone <repo-url> && cd assistant
./setup.sh
```

The interactive setup wizard walks you through:

1. **Data storage** - where to keep personal data (local, iCloud, OneDrive, custom path)
2. **Life contexts** - define your categories (e.g., Work, Personal, Church, Side Project)
3. **Journal locations** - per-context journal storage with path templates
4. **Data isolation** - mark contexts whose data must stay separate (e.g., employer policy)
5. **GitHub account** - verify git/gh CLI configuration
6. **Employer domain** - for classifying meeting attendees as internal/external

Setup generates `data/config.yaml` from your answers. The `data/` directory is **gitignored** so your personal information never reaches GitHub.

After setup, fine-tune `data/config.yaml` and fill in `data/context/identity.md` with your name, role, and team.

## Structure

```
prompts/          VS Code Copilot agent prompts
things3/          Things 3 CLI scripts
scripts/          Core tools (atlas-db.py)
dashboard/        Express.js dashboard (port 3141)
automation/       Scheduled launchd automation scripts
context/          Framework docs (triage rules, schemas, architecture)
filter-scripts/   Email/spam filter scripts
data/             Personal data (gitignored, created by setup.sh)
  briefings/      Daily briefing files (.json, .md)
  state/          SQLite database, logs
  context/        Identity, priorities, action items, waiting-on-others
data-templates/   Templates copied into data/ during setup
```

## Workflow Commands

- **`/check-briefing`** — Immediately sync newly-checked briefing items to Things 3 + action tracking (no wait for scheduled syncs)
- **`/done ...`** — Quick completion capture that marks tasks complete in Things 3 and updates action tracking
- **`/end-of-day`** — EOD sync with journal capture and final checkpoint processing

## Checkbox Workflow

Your morning briefing now includes `- [ ]` checkboxes for all actionable items:
- **HIGH/MEDIUM communications** that need action
- **Meeting prep items** that require review
- **Overdue items** from action-items.md
- **Today's tasks** from Things 3

As you complete work, just check the box in Typora. Then:
- **On demand**: Run `/check-briefing` to immediately push checked items to Things 3.
- **Continuously**: The 15-minute sync job detects completions and propagates them automatically.
- **At end of day** (or manually): end-of-day agent processes any remaining items and finalizes the day.

No need to switch between briefing, Things 3, and email—just check the box and move on.

## Stable Task IDs

All commitment tracking goes through `atlas-db.py`, which auto-syncs to Things 3 and renders markdown views.

```sh
ATLAS="python3 ~/projects/personal/assistant/scripts/atlas-db.py"
$ATLAS commit add --title "Task title" --direction mine --person "Someone" --source "email/2026-04-21" --due "2026-04-25" --category work
$ATLAS commit search "Task title"
$ATLAS commit complete --task-id "AI-20260421-101530"
```

## Wake Schedule (one-time)

To wake the Mac before scheduled jobs fire, run once with sudo:

```sh
sudo zsh assistant/automation/scripts/setup-wake-schedule.sh
```

This sets a `pmset` wake at **6:25 AM Mon–Fri**, 5 minutes before the morning briefing. Only works reliably on AC power. To verify: `pmset -g sched`. To remove: `sudo pmset repeat cancel`.

## Backups

Original files are backed up at:
- `~/Library/Application Support/Code/User/prompts.bak`
- `~/.local/bin/things3.bak`
- `~/.local/bin/filter-spam-emails.py.bak`

Safe to remove once this repo is pushed to GitHub.
