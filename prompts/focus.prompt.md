---
mode: agent
description: "Enter focus mode: surface only the top 3 items and suppress everything else"
tools:
  - run_in_terminal
  - read_file
  - replace_string_in_file
---

# Focus Mode

Strip away the noise and surface only what matters right now. Use when the user says "I need to focus" or "what should I work on next."

Follow the shared preamble in `.instructions.md` for setup, execution rules, and gotchas.

## Steps

1. **Read objectives and MITs**
   ```sh
   $ATLAS objective list
   $ATLAS mit list
   ```

2. **Read today's briefing JSON**
   ```sh
   cat ~/projects/personal/assistant/data/briefings/$(date +%Y-%m-%d)_daily_brief.json
   ```

3. **Rank all open items** by this priority stack:
   - Incomplete MITs (from step 1, highest priority since user already chose them)
   - Overdue commitments (from `accountability.overdue`)
   - Tasks that advance an active objective but aren't MITs
   - HIGH inbox/carryOver items with a deadline today
   - Meeting prep needed in the next 2 hours
   - HIGH inbox/carryOver items without a deadline
   - MEDIUM items with a deadline today
   - Everything else (suppress)

4. **Present exactly 3 items** in this format:

   ```
   🎯 Focus Mode — [time now]
   Objectives: 1) [obj1] 2) [obj2] 3) [obj3]

   1. [item text] — [why now: "MIT #1" / "advances obj #2" / "overdue 3 days"]
   2. [item text] — [why now]
   3. [item text] — [why now]

   Everything else is parked. Run /focus again when you finish one.
   ```

5. **If fewer than 3 items qualify**, say so:
   ```
   🎯 Focus Mode — only 1 urgent item right now.

   1. [item text] — [why now]

   You have space. Consider tackling a MEDIUM item or deep work.
   ```

6. **Do not** show meetings, accountability, low-priority items, waiting-on-others, or any other section. Focus mode is a filter, not a briefing.
