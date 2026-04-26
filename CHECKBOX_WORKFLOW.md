---
title: Checkbox Completion Workflow
date: 2026-04-21
---

# Interactive Briefing Checkboxes + Completion Workflow

## Overview

You now have a fully integrated completion tracking system that lets you mark work complete in one place (your briefing), and it automatically syncs across Things 3 and action tracking throughout the day.

## Daily Flow

### Morning (6:30 AM)
1. Briefing generates and opens in Typora automatically
2. All actionable items have checkboxes: `- [ ]` HIGH communications, MEDIUM items, meeting prep, overdue items, today's tasks
3. Read the brief and note what needs doing

### Throughout the Day
1. As you complete work, **just check the box in Typora**—no need to switch contexts
2. Checkboxes in briefing are the source of truth for completion

### Anytime (Manual Sync)
1. Run `/check-briefing` command to trigger immediate sync
2. Detects any newly-checked boxes in your briefing
3. Immediately completes matching tasks in Things 3 (using stable Task IDs)
4. Updates action-items.md to move completed items
5. Reports: "Sync complete. X items closed from briefing checks"

### Continuous (every 15 min, automated)
1. The briefing-sync job runs every 15 minutes during work hours
2. Detects items marked done/dismissed in the dashboard
3. Propagates completions to Things 3 and action-items.md
4. Clears `syncPending` flags after successful sync

### End of Day (manual or 5:15 PM reminder)
1. Run `/end-of-day` manually or wait for the 5:15 PM reminder
2. Agent processes any remaining unchecked items
3. Closes out your workday with a final checkpoint update
4. Includes briefing checkpoint processing in your reflection

## Commands

### `/check-briefing` — Immediate Manual Sync (NEW)
Use this to push checked items to Things 3 and action tracking **right now** without waiting for scheduled syncs.

```
/check-briefing
```

The agent will:
- Read your current briefing
- Detect newly-checked boxes since last sync
- Immediately complete matching Tasks 3 tasks by Task ID
- Update action-items.md
- Save checkpoint state so midday/EOD syncs won't duplicate
- Report how many items were synced

**Usage Pattern**: After you check several items in Typora, run `/check-briefing` to close them out immediately across all systems.

### `/done` — Quick Completion Capture
Use this to mark something complete without opening the briefing.

```
/done AI-20260421-082145
/done reviewed Tanvi's report
/done finished budget proposal
```

The agent will:
- Search Things 3 by Task ID (if you provide `AI-...`) or keyword
- Mark it complete
- Update action-items.md
- Return a receipt: "Completed: Review corrected ADO report"

### `/things3` — Task Management
Query or manage your Things 3 tasks directly.

```
/things3 today           # Show today's tasks
/things3 completed       # Show completed tasks
```

## Task IDs and Cross-System Matching

Every task created now has a stable ID embedded in its notes:
- Format: `AI-YYYYMMDD-HHMMSS` (example: `AI-20260421-101530`)
- Embedded in task notes when created by briefing workflows
- Also stored in action-items.md entries for deterministic matching

### When Creating a New Task
```sh
ATLAS="python3 ~/projects/personal/assistant/scripts/atlas-db.py"
$ATLAS commit add --title "Task title" --direction mine --person "Someone" --source "briefing" --due "YYYY-MM-DD" --category work
```

### Completing by Task ID
```sh
$ATLAS commit complete --task-id "AI-20260421-101530"
```

## How the Checkpoint System Works

1. **Briefing generation**: Morning briefing creates `- [ ]` checkboxes for all actionable items
2. **Initial state saved**: Checkpoint stored to `~/.checkpoints/YYYY-MM-DD.json` with all checkbox states
3. **You check boxes**: Throughout the day, you check boxes as you work
4. **Sync detects changes**: Midday and EOD agents run `checkpoint-helper.py compare` which:
   - Loads last saved state
   - Compares current briefing against it
   - Returns list of newly-checked items
5. **Auto-complete**: Newly-checked items are auto-completed in Things 3 (highest confidence signal)
6. **State updated**: After processing, `checkpoint-helper.py save-state` stores the new state

## Safety Features

- **Briefing checkboxes are authoritative**: If it's checked, it gets completed (high confidence)
- **Task IDs are deterministic**: No fuzzy matching needed—exact ID lookup
- **Ambiguous matches ask first**: If multiple tasks could match a keyword, you're asked for clarification
- **Stale items tracked**: If a briefing is 2+ days old, items are logged but still processed
- **Non-tracked items ignored**: If you check a box that doesn't match any task, it's logged but doesn't error

## Examples

### Example 1: Complete via checkbox
1. Morning briefing shows:
   ```
   - [ ] Approve OneRAI Release Assessment
   ```
2. You work through morning, then check the box:
   ```
   - [x] Approve OneRAI Release Assessment
   ```
3. The 15-minute sync job detects the dashboard completion, finds matching task in Things 3, completes it
4. action-items.md is updated to reflect completion

### Example 2: Complete via Task ID
1. Briefing shows:
   ```
   - [ ] Review corrected ADO Epic Change Report from Tanvi (Task ID: AI-20260421-082145)
   ```
2. You finish the review, either:
   - Check the box in briefing, OR
   - Run: `/done AI-20260421-082145`
3. Either way, Things 3 task is marked complete with high confidence (exact ID match)

### Example 3: Complete via keyword
1. You run: `/done finished email to Heather`
2. Agent searches Things 3 for "email to Heather"
3. If one match found: auto-complete
4. If ambiguous: agent asks "Did you mean: [task 1] or [task 2]?"

## Automation & Manual Sync

**Manual**: `/check-briefing` — Run anytime to immediately sync newly-checked items
- Detects changes in your briefing since last checkpoint
- Completes matching Things 3 tasks by Task ID
- Updates action-items.md
- No waiting for scheduled syncs

**Scheduled**: Briefing sync (every 15 min) and End-of-Day
- Continuous sync propagates dashboard completions to Things 3 and action-items.md
- Checkpoint state prevents duplicates (idempotent)

## Troubleshooting

**Checkpoint not syncing?**
- Check that your briefing file exists: `~/projects/personal/assistant/briefings/YYYY-MM-DD_daily_brief.md`
- Verify checkpoint state file was created: `~/.checkpoints/YYYY-MM-DD.json`
- Run manually: `/check-briefing` or `/end-of-day`

**Task not completing?**
- Check that task exists in Things 3: `~/.local/bin/things3/search.sh "keyword"`
- If using Task ID, verify it's in the task notes
- Run `/done` manually as fallback

**Multiple matches when using keyword?**
- Use Task ID instead (deterministic)
- Or run `/done` and answer the disambiguation question

## Configuration

All checkpoint state stored in: `~/.checkpoints/`
Each briefing date gets its own state file: `YYYY-MM-DD.json`

To reset a checkpoint: `rm ~/.checkpoints/YYYY-MM-DD.json`

Next morning briefing will start fresh checkpoint state.
