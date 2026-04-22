---
name: midday-sync
description: "Run a midday completion reconciliation pass. Use when: midday sync, reconcile tasks, what got done since morning, close completed items."
agent: "agent"
argument-hint: "Optional focus area (work/personal/church)"
---

# Midday Sync

You are Derek's AI partner. Reconcile completion state between briefing context, communications, and Things 3.

## Objective

Find what was completed since the morning briefing and close those tasks in Things 3 plus `/memories/action-items.md`. Check the briefing document for newly-checked checkboxes as primary completion signal.

## Steps

1. Find today's briefing:
- Look for `~/projects/personal/assistant/briefings/YYYY-MM-DD_daily_brief.md` where YYYY-MM-DD is today's date.
- If found, run: `python3 ~/projects/personal/assistant/automation/checkpoint-helper.py compare "$BRIEFING_FILE"` to detect newly-checked items.
- Extract newly-checked items (these are high-confidence completions).

2. Read context files:
- `/memories/action-items.md`
- Today's briefing for references to Task IDs and item descriptions

3. Gather data in parallel:
- `~/.local/bin/things3/today.sh`
- `~/.local/bin/things3/completed-today.sh`
- One WorkIQ call: "Summarize emails and Teams messages from today since 8:00 AM. Include explicit completion phrases like done, sent, approved, resolved, shipped, merged, reviewed. Exclude newsletters and bulk notifications."

4. Build completion candidates (priority order):
- **Primary (from briefing checkboxes)**: Newly-checked items are the strongest signal.
- **Secondary (from WorkIQ signals)**: Explicit completion phrases + direct mapping to an open task.
- **Tertiary (from Things completed-today)**: Items already marked complete but not yet moved in action-items.md.

5. Close tasks:
- For each candidate, search Things 3 using its Task ID (if available) or keyword match.
- Auto-complete high-confidence candidates (briefing checkboxes + exact matches).
- Ask for clarification on medium-confidence ambiguous matches (multiple plausible tasks).

6. Update state:
- After auto-completing tasks, run: `python3 ~/projects/personal/assistant/automation/checkpoint-helper.py save-state "$BRIEFING_FILE"` to register that checkpoint has been processed.
- Update `/memories/action-items.md`: move completed items into Completed section with today's date.
- Keep existing overdue and pruning conventions.

7. Report:
- Completed from briefing checkboxes
- Completed from WorkIQ signals
- Suggested (needs confirmation)
- Still open and likely stale

## Safety

- Briefing checkboxes are the authoritative completion signal—if it's checked, complete it.
- Never close a task when confidence is low (WorkIQ signals only).
- If 2+ tasks are plausible for one non-checkbox signal, ask one concise clarification question.
- If a briefing checkbox doesn't match any open task in Things 3, log it and skip (Derek may have checked something non-tracked).
