# Assistant

Personal AI assistant configuration: VS Code prompts, Things 3 scripts, and utility scripts.

## Structure

```
prompts/          VS Code Copilot prompts (symlinked from ~/Library/Application Support/Code/User/prompts)
things3/          Things 3 CLI scripts (symlinked from ~/.local/bin/things3)
filter-scripts/   Email/spam filter scripts (symlinked from ~/.local/bin/)
automation/       Scheduled launchd automation scripts + manifest
```

## Workflow Commands

- **`/check-briefing`** — Immediately sync newly-checked briefing items to Things 3 + action tracking (no wait for scheduled syncs)
- **`/done ...`** — Quick completion capture that marks tasks complete in Things 3 and updates action tracking
- **`/midday-sync`** — Midday reconciliation pass that closes high-confidence completed items (automatic at 12 PM)
- **`/end-of-day`** — EOD sync with journal capture and final checkpoint processing

## Checkbox Workflow

Your morning briefing now includes `- [ ]` checkboxes for all actionable items:
- **HIGH/MEDIUM communications** that need action
- **Meeting prep items** that require review
- **Overdue items** from action-items.md
- **Today's tasks** from Things 3

As you complete work, just check the box in Typora. Then:
- **At midday** (12:00 PM): midday-sync agent runs automatically, detects newly-checked items, closes matching tasks in Things 3.
- **At end of day** (or manually): end-of-day agent processes any remaining unchecked items and finalizes the day.

No need to switch between briefing, Things 3, and email—just check the box and move on.

## Stable Task IDs

New task creation now supports durable IDs for deterministic matching across briefing, Things 3, email, and Teams.

```sh
TASK_ID=$(~/.local/bin/things3/new-id.sh)
~/.local/bin/things3/add.sh "Task title" --task-id "$TASK_ID" --notes "Source: ..."
~/.local/bin/things3/search.sh --task-id "$TASK_ID"
~/.local/bin/things3/complete.sh --task-id "$TASK_ID"
```

## Setup

After cloning, create symlinks:

```sh
ln -sf "$(pwd)/prompts" ~/Library/Application\ Support/Code/User/prompts
ln -sf "$(pwd)/things3" ~/.local/bin/things3
ln -sf "$(pwd)/filter-scripts/filter-spam-emails.py" ~/.local/bin/filter-spam-emails.py
```

### Wake Schedule (one-time)

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
