---
name: check-briefing
description: Manually trigger immediate sync of checked briefing items to Things 3 and action tracking
tools:
  - run_in_terminal
  - read_file
---

# Manual Briefing Checkpoint Sync

User is requesting an immediate sync of newly-checked items from their daily briefing.

## Goal
Detect checkbox changes in today's briefing and immediately:
1. Complete matching Tasks 3 tasks (by Task ID)
2. Update action-items.md
3. Report what was synced
4. Save new checkpoint state

## Steps

### Step 1: Find Today's Briefing
Locate today's briefing file (format: `briefings/YYYY-MM-DD_daily_brief.md`).
Use today's date to construct the path.

### Step 2: Run Checkpoint Compare
Run checkpoint helper to detect newly-checked items:
```bash
python3 assistant/automation/checkpoint-helper.py compare "briefings/YYYY-MM-DD_daily_brief.md"
```

Parse the JSON output to extract:
- `newly_checked`: List of items user just checked
- `newly_unchecked`: List of items user just unchecked

### Step 3: Process Each Newly-Checked Item

For each newly-checked item:

1. **Extract Task ID** from the item text (format: `Task ID: AI-YYYYMMDD-HHMMSS`)
   - If found, use it for deterministic matching
   - If not found, note the item text for logging

2. **Complete in Things 3**
   ```bash
   assistant/things3/complete.sh --task-id "AI-..."
   ```
   This marks the task complete in Things 3 database.

3. **Update action-items.md**
   - Find the matching line in `context/action-items.md`
   - Change `- [ ]` to `- [x]`
   - Add completion timestamp: `| Completed: $(date +%Y-%m-%d)`
   - Move it to the "## Completed" section if it exists

### Step 4: Report Results

Provide a summary of what was synced:
```
✓ Midday Check Complete
- X items marked complete in Things 3
- X items updated in action-items.md
- Checkpoint state saved for 2026-04-21

Items processed:
  ✓ Review corrected ADO Epic Change Report from Tanvi (Task ID: AI-20260421-082145)
  ✓ Help Sonia compile growth efforts inventory (Task ID: AI-20260421-090212)
  ...
```

### Step 5: Save New Checkpoint State

After processing all items:
```bash
python3 assistant/automation/checkpoint-helper.py save-state "briefings/YYYY-MM-DD_daily_brief.md" "YYYY-MM-DD"
```

This saves the current state so the next sync (midday at noon, EOD) won't reprocess these items.

## Error Handling

- **If briefing file not found**: "Today's briefing not found. Create one first with `/morning-briefing`"
- **If checkpoint state file corrupted**: "Warning: Checkpoint state invalid. Starting fresh for today."
- **If Things 3 task not found**: "Warning: No Things 3 task found for [item text]. Check Task ID."
- **If action-items.md not found**: "Warning: action-items.md not found. Skipping action item sync."

## Next Steps After Sync

User can now:
- Continue working (briefing is checkpoint synced)
- Check more items and run again anytime
- Trust that midday/EOD syncs won't duplicate these completions (state file prevents it)
