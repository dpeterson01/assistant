---
name: morning-briefing
description: "Start the day with a briefing across work, personal, and church contexts. Use when: good morning, start my day, what's on my plate, morning briefing, daily briefing, what do I have today, brief me."
agent: "agent"
argument-hint: "Optional: specific context to focus on (work, personal, church)"
---

# Morning Briefing

You are Derek's AI partner. This prompt picks up where yesterday left off, surfaces what came in overnight, briefs on each meeting, sets today's plan, and syncs Things 3. Move fast.

## Determine today's date (MANDATORY first step)

Before doing ANYTHING else, run this in a terminal:
```sh
date '+%A %B %d, %Y'
```
Use the **exact output** as today's date and day-of-week for the entire briefing. Never calculate the day-of-week from a date string yourself — LLMs get this wrong for future dates. The shell `date` command is the single source of truth.

## How Checkboxes Work

Every actionable item in the briefing gets a checkbox: `- [ ]`. Derek can check items as he completes them throughout the day. When ready to push completions immediately to Things 3 and action-items (instead of waiting for the 15-min sync), he runs:
```
/check-briefing
```
This detects newly-checked items, completes matching Things 3 tasks by Task ID, and updates action tracking. Scheduled syncs (midday at noon, end-of-day) won't reprocess checked items (checkpoint state prevents duplicates).

**Three ways to mark complete:**
1. **Check in briefing**: `- [x]` in Typora → run `/check-briefing` to push immediately
2. **Quick command**: `/done "task name"` or `/done AI-task-id` mid-work without reopening briefing
3. **Scheduled sync**: Items automatically close at midday/EOD if still unchecked

## Execution Rules

**Resilience**: Every step and tool call has a soft budget. If a tool call fails or returns an error, retry ONCE. If it fails again, log what failed ("⚠️ [tool/step] failed: [reason]"), skip it, and continue. Never retry the same failing call more than once. Never block the entire briefing on a single data source. Report all skipped items at the end so Derek knows what's missing.

**Parallelism**: Gather independent data sources simultaneously. Specifically:
- Personal email (Outlook MCP), work email (Gmail MCP), HMBL email, iMessages, Things 3 shell commands, and WorkIQ calls are ALL independent. Fire them in a single parallel batch, not sequentially.
- Only sequence calls that depend on prior results (e.g., reading a specific email found in a search).
- When writing journals, syncing Things 3, and updating memory files, those are also independent of each other.

**Terminal timeouts**: Always set an explicit timeout on every terminal command. Use 10000ms (10s) for quick commands (Things 3 scripts, ls, file reads). Use 30000ms (30s) for longer operations (email_cleanup.py, batch scripts). Never use timeout=0 (infinite).

**Progress**: If a step is taking multiple tool calls without progress, skip it with a note and move on.

## Data Architecture

See [data-architecture.md](../context/data-architecture.md) for full query/mutation reference.

```sh
ATLAS="python3 ~/projects/personal/assistant/scripts/atlas-db.py"
```

Read `/memories/identity.md` and `/memories/priorities.md` first. Then run `$ATLAS sync-things3` and query the DB for commitments. Hold these in context for the entire briefing.

The briefing has two phases:
- **Phase A (Steps 1-2-3)**: Gather, brief Derek, save and open in Typora. Get Derek reading ASAP.
- **Phase B (Steps 4-5-6)**: Maintenance. Sync Things 3, update memory files, surface conflicts. Runs while Derek reads.

---

# Phase A: Get the briefing to Derek fast

## Step 1: Reload context (do all in parallel where possible)

### Recent briefings (primary context source)
Check if any briefings exist: `ls ~/projects/personal/assistant/data/briefings/ 2>/dev/null | head -1`

**If briefings exist**: Read the last 3-5 daily briefings (most recent by date). Use `ls -t ~/projects/personal/assistant/data/briefings/ | head -5`. Extract:
- Recurring meeting patterns and open follow-ups
- Items that have appeared in multiple briefings without resolution (flag these as stale)
- Prior meeting context for today's attendees
- Carry-forward action items and their trajectory

**If no briefings exist**: Skip this section entirely. Prior context will come from journals and memory files only.

### Last weekly review (Monday mornings, or if no briefings exist from prior week)
If today is Monday (or the most recent daily briefing is 3+ days old), also read the most recent weekly review:
- Work: `ls -t ~/Library/CloudStorage/OneDrive-Microsoft/journals/weekly/ | head -1`
- Personal: `ls -t ~/Library/Mobile\ Documents/com~apple~CloudDocs/personal/weekly/ | head -1`

These contain the prior week's wins, team accomplishments, patterns, unfinished items, and priorities for this week. Use them to anchor today's focus.

### Yesterday's close-out
Read `~/.local/share/daily-consolidation/last-session.txt` to get the last end-of-day date.
Read that date's journals:
- Work: `~/Library/CloudStorage/OneDrive-Microsoft/journals/work/YYYY-MM-DD.md`
- Personal: `~/Library/Mobile Documents/com~apple~CloudDocs/personal/journals/YYYY-MM-DD.md`

Extract: open threads, action items, "tomorrow" suggestions, anything unresolved.

If the file doesn't exist or there was no end-of-day session, read the most recent journal from each path instead.

### Today's existing data
Read today's journals if they exist (the generate script may have already created personal journals with iMessage/email data overnight):
- Personal: `~/Library/Mobile Documents/com~apple~CloudDocs/personal/journals/YYYY-MM-DD.md`
- Work: `~/Library/CloudStorage/OneDrive-Microsoft/journals/work/YYYY-MM-DD.md`

### Things 3 — what's already queued
Run both in terminal:
- `~/.local/bin/things3/today.sh` (today's task list)
- `~/.local/bin/things3/upcoming.sh` (next 7 days)

### Church workstreams
Church is an active life context. Check for church-related activity and include it in the briefing when relevant.

**Data sources** (check all, in parallel with other Step 1 sources):
- **Things 3**: `~/.local/bin/things3/by-tag.sh church` and search for church project tasks: `~/.local/bin/things3/search.sh "church\|parish\|confirmation\|RCIA"`
- **Priorities**: The "Church" section in `/memories/priorities.md` lists active church commitments
- **Personal email**: Search personal Outlook (drp80@outlook.com) for recent church-related emails. Use `mcp_hmbl-mail_outlook_search` with query "church OR parish OR Father Francisco OR confirmation OR RCIA" limited to last 7 days.
- **iMessages**: On weekends, check for messages from church contacts (Father Francisco, Brenda Alford, Holli Sullivan, or anyone else in the church context). Use `mcp_mac-messages_tool_fuzzy_search_messages` with relevant names.
- **Personal journal**: Today's personal journal (if it exists) may contain church-related entries from the overnight generate script.

**Include in briefing when**:
- There are open church tasks in Things 3 (always surface)
- Church items in priorities.md have approaching deadlines or are overdue
- Overnight email/iMessage activity involves church contacts
- A church event or meeting is on the calendar today

**Briefing placement**: Church items appear in the appropriate sections (carry-over, tasks, accountability) alongside work and personal items. Tag them with "🏛️" prefix so Derek can scan. On weekends, promote church items higher since work items are typically lower priority.

**Things 3 routing**: Church tasks go to the appropriate Church project (Track 1-4). See the Things 3 skill for project names.

### Upcoming birthdays
Run in terminal:
- `~/.local/bin/contacts/birthdays.sh 14` (next 14 days)

Surface any birthdays happening today, tomorrow, or this week. If a birthday contact is also a meeting attendee today, flag it in their meeting briefing.

### Overnight activity and today's meetings (single WorkIQ call)
Make ONE call to `mcp_workiq_ask_work_iq`. This is the only WorkIQ call in the entire briefing. Do not make per-meeting follow-up calls.

> Give me everything I need to start my day for YYYY-MM-DD.
>
> **Overnight activity (since 5pm yesterday):**
> - Emails received (exclude marketing, newsletters, automated notifications, mass distribution)
> - Teams messages and channel activity
>
> **Unread items from prior days:**
> - Any unread emails from the past 5 business days (exclude marketing, newsletters, automated notifications)
> - Any unread Teams messages from the past 3 days
>
> **Today's meetings:**
> List every meeting with: title, time, duration, full attendee list with roles/titles if known, and meeting description/agenda.
>
> Format emails as: **Subject** | From: [name] | Summary: [1 sentence]
> Format Teams as: **Chat/Channel** | From: [name] | Summary: [1 sentence]

### Build meeting briefings (from briefing archive + overnight data)
For each meeting today, assemble a briefing by combining:

1. **Prior briefings**: Search the recent briefings (loaded above) for any mention of attendees, meeting title, or related topics. Extract prior signals, open follow-ups, and unresolved items.
2. **Overnight data**: Match overnight emails/Teams from the WorkIQ response to meeting attendees.
3. **Memory files** (already loaded): Cross-reference action-items.md (does Derek owe an attendee?) and waiting-on-others.md (does an attendee owe Derek?).
4. **Work contacts directory**: Read `~/Library/CloudStorage/OneDrive-Microsoft/01_people/contacts/index.json` once to get the name-to-file mapping. For each attendee, look up their entry in the index (match on name, aliases, or email). Read matching contact files for context (role, working style, personal details, history). This is especially useful for cross-team contacts and people whose filenames don't match their display name.
5. **Yesterday's journal**: Open threads involving these people.

Only if a meeting has no prior briefing context AND involves unfamiliar attendees or a new topic, make a targeted WorkIQ follow-up call. This should be rare.

Assemble each meeting briefing with this structure:
```
### [Meeting Title] (time, duration)
**Attendees**: [names, roles if known]
**Agenda**: [from invite, or inferred from signals, or "None provided"]
**Signals**:
- [source] [who] [when]: [1-sentence summary]
**Open items with attendees**:
- [item from action-items/waiting-on-others/prior briefings, or "None"]
**Suggested talking points**:
- [1-2 specific things Derek should raise based on signals and open items]
**Prep**: [specific action needed, or "None"]
```

For recurring standups or office hours with no signals, compress to one line: "**Title** (time) - Recurring, no specific prep."

### Write per-meeting brief files (high-stakes meetings only)

In addition to the inline briefing assembled above, write a deeper standalone brief for each **high-stakes** meeting. A meeting is high-stakes if any of these are true:
- ≥1 external attendee (different domain than `microsoft.com`)
- Title matches `1:1`, `sync`, `review`, `decision`, `interview`, `leadership`, `debrief`, `prep`, or `kickoff` AND duration ≥ 25 minutes
- Derek owes someone in the meeting an action item (per `action-items.md`)
- Someone in the meeting owes Derek something overdue (per `waiting-on-others.md`)

For each high-stakes meeting:
1. Run `$ATLAS meeting add --event-id "<event_id>" --title "<title>" --start "<iso_start>" --end "<iso_end>" --attendees "<names>" --external <count>`. If the event already exists with `brief_status=sent` or `refreshed`, the rolling sweep already produced a brief — skip and reference its path in the inline daily brief.
2. Otherwise, generate the per-meeting brief using the same structure as `/meeting-brief` (see `assistant/prompts/meeting-brief.prompt.md` for the template) and write it to the path that the brief generator uses.
3. Run `$ATLAS meeting mark --event-id "<event_id>" --status sent --file <path>`.
4. In the inline daily brief's `## Today's meetings` section, add a `📄 Deep brief:` link line beneath the inline summary pointing to the per-meeting file (relative path from repo root).

Routine standups, office hours, and large-distribution meetings stay inline-only — do not write a per-meeting file for them.

### iMessages (weekends and personal context only)
On weekdays, skip the iMessage fetch. Today's personal journal already has overnight iMessages if the generate script ran. Only fetch iMessages on weekends or if explicitly asked.

Use the `mac-messages` MCP server for all iMessage operations: `get_recent_messages`, `find_contact`, `get_chat_transcript`, `fuzzy_search_messages`.

### Triage all inbound communications
After collecting emails and Teams, classify every item using the rules in [triage-rules.md](../context/triage-rules.md). That file defines:
- Hard exclusions (access requests, etc.)
- Priority tiers (🔴 HIGH, 🟡 MEDIUM, 🟢 LOW) with sender-based rules and aging boosts
- Thread escalation rules
- Action item extraction tests (5-point filter before creating any task)
- Inline draft reply confidence thresholds

Apply triage to every inbound item before proceeding to Step 2.

## Step 2: Brief Derek

Present a tight morning briefing. No fluff.

### Day Fit Score
A single calibrated read of how today's calendar shape compares to a sustainable day. Compute before writing the briefing using the meeting list assembled in Step 1.

Score on these 6 criteria (0 if missed, full points if met). Total 100.

| Pts | Criterion |
|-----|-----------|
| 20  | Top morning focus block (90+ minutes before noon, no meetings) is intact |
| 20  | ≤2 customer or external meetings before noon |
| 15  | Lunch protected: nothing scheduled 12:00–13:00 local |
| 20  | Deep work window protected: nothing scheduled 13:00–15:30 local (or equivalent ≥2h afternoon block) |
| 15  | Late-day buffer: nothing customer-facing 15:30–16:00; only self-organized or recurring after 16:00 |
| 10  | At least 1 hour for learning, reading, or thinking somewhere in the day |

Display at the top of Step 2 output as a single banner line:

- 🟢 80–100: "Day Fit: 🟢 N/100 — solid shape"
- 🟡 50–79: "Day Fit: 🟡 N/100 — workable, watch [specific gap, e.g., 'lunch is taken']"
- 🔴 0–49: "Day Fit: 🔴 N/100 — consider declining/moving [specific meeting] to recover [specific block]"

Below the banner, list the criteria that failed in one line each (e.g., "❌ Lunch — 12:30 customer call. ❌ Deep work — back-to-back 13–15."). Skip if score is 🟢.

If score is 🔴, suggest 1–2 specific moves to recover (decline X, push Y to tomorrow, batch async). Keep it to one line per suggestion.

### What carried over from yesterday
- Unresolved threads and action items from yesterday's journals
- Items in action-items.md that are overdue or due today

**Display**: Prefix each with `- [ ]` checkbox so Derek can check them as he tackles them throughout the day.

### What came in overnight (triaged)
Present communications grouped by importance tier. For each item show the tier emoji, source (email/Teams), sender, age if older than overnight, and 1-sentence summary.

**🔴 HIGH** items first (prefix with `- [ ]` checkbox and Task ID if created in Things 3; briefly state what Derek needs to do)
**🟡 MEDIUM** items next (prefix actionable ones with `- [ ]` checkbox and Task ID)
**🟢 LOW** items: just a count ("X low-priority items, nothing actionable"; no checkboxes)

If there are unread items from prior days, call them out: "N unread items aged 2+ days, escalated."

#### Inline draft replies (high-confidence only)

Score each 🔴/🟡 email item using the `/draft-message` Step 2.5 confidence model. Follow the confidence thresholds and exclusions defined in [triage-rules.md](../context/triage-rules.md#inline-draft-replies).

Log every auto-saved draft to `assistant/data/state/auto-drafts.log` as `YYYY-MM-DDTHH:MM:SS | <recipient> | <subject> | <confidence> | <thread-id>` so Derek and `/briefing-tune` can audit hit rate.

### Today's meetings
Present the full meeting briefings assembled in Step 1, in chronological order. For each meeting show:
- **Title** (time) with key attendees
- **Why it matters today**: 1-2 sentences synthesizing the signals, agenda, and open items
- **Signals**: The most relevant 2-3 signals (skip if routine standup with nothing notable)
- **Raise this**: Specific things Derek should bring up (from open items, waiting-on-others, or signal context). If an attendee owes Derek something, say so directly.
- **Prep**: Prefix with `- [ ]` checkbox if Derek needs to prep before this meeting, else "None"

For low-signal recurring meetings (standups, office hours), compress to one line: "**Title** (time) - Recurring, no specific prep."

For meetings with prep needed, prefix with `- [ ]` checkbox so Derek can check it off once prepped.

### Accountability check
- **My overdue items**: Run `$ATLAS commit overdue` to get all overdue items. Surface items where direction=mine. Prefix each with `- [ ]` checkbox. Be direct.
- **Waiting on others**: Run `$ATLAS commit list --direction theirs --status active` to get active items others owe Derek. For each active item:
  - If they're in a meeting today: `- [ ]` "Bring up [item] with [person] in [meeting name]"
  - If overdue and not recently nudged: "Consider running `/nudge [person]` to follow up"
  - Count: "X items pending from others, Y overdue"
- **Auto-nudge candidates**: Items where `daysOpen >= 5` AND `last_nudge` is null or older than 3 days are auto-nudge candidates. For each:
  - Set `stale: true` in the JSON `accountability.waitingOn` entry
  - In the .md, append: "⏰ Stale 5+ days. Run `/nudge [person]` or use the dashboard nudge button."
  - If the person is in a meeting today, prefer the in-meeting approach over a nudge message.

### Birthdays
If any birthdays are coming up in the next 7 days, list them. Today/tomorrow birthdays get a 🎂 callout. If a birthday person is a meeting attendee or direct report, suggest acknowledging it.

### Today's tasks
- Prefix each Things 3 Today item with `- [ ]` checkbox
- Suggested priorities: rank the top 3 things to focus on today, considering meetings, carry-forward items, deadlines, and action items

### Upcoming (next 2-3 days)
- Deadlines approaching
- Things 3 Upcoming items worth noting

Keep the briefing under 50 lines. Lead with what matters most.

## Step 3: Save and open briefing

Save the full briefing output to `~/projects/personal/assistant/data/briefings/YYYY-MM-DD_daily_brief.md` where YYYY-MM-DD is today's date.

The file should contain:
- A YAML frontmatter block with `date`, `meetings_count`, `action_items_count`, `high_priority_count`, and `checkpoint_id` (format: `AI-YYYYMMDD-HHMMSS`)
- After frontmatter, add a hidden checkpoint state comment:
  ```markdown
  <!-- checkpoint_state: {"initialized": true, "sync_count": 0} -->
  ```
- The complete briefing as presented to Derek (Step 2 output)

Note: checkpoint_id and checkpoint state are used by `/check-briefing` and scheduled syncs to track which items have been processed and prevent duplicate completions.

Open it in Typora immediately so Derek can start reading:
```sh
open -a Typora ~/projects/personal/assistant/data/briefings/YYYY-MM-DD_daily_brief.md
```

## Step 3b: Generate dashboard JSON

Also save a structured JSON file to `~/projects/personal/assistant/data/briefings/YYYY-MM-DD_daily_brief.json`. This powers the interactive dashboard at `http://localhost:3141`.

Build the JSON from the same data gathered in Steps 1-2. Follow the schema defined in [dashboard-json-schema.md](../context/dashboard-json-schema.md), which specifies:
- Top-level structure (dayFit, carryOver, inbox, meetings, tasks, accountability, upcoming)
- Per-item fields and deep link fields
- Meeting fields and high-stakes criteria
- Accountability structure
- Reconciliation rules (every .md checkbox must have a matching JSON entry)

Then continue to Phase B while Derek reads.

### Open the dashboard
After saving the JSON, open the interactive dashboard in Microsoft Edge:
```sh
open -a "Microsoft Edge" http://localhost:3141
```

---

# Phase B: Maintenance (runs while Derek reads the briefing)

## Step 4: Sync Things 3

Every action item identified during triage becomes a Things 3 task. No exceptions for HIGH items. MEDIUM items become tasks if they have a clear "do" action.

### Sources that generate tasks
1. 🔴 HIGH communications (email, Teams) with an action for Derek
2. 🟡 MEDIUM communications with a clear, specific ask
3. Carry-forward items from yesterday's journal not yet in the DB
4. Meeting prep tasks (from Step 2 meeting briefs)

### Batch deduplication
Before adding tasks, search the DB for existing matches:
```sh
$ATLAS commit search --query "keyword"
```
Skip any candidate that already has a matching commitment.

### Add missing tasks (batch when possible)
For each task to add, use atlas-db which auto-generates a Task ID, pushes to Things 3, and re-renders markdown:
```sh
$ATLAS commit add --title "Task title" --direction mine --person "Person" --source "email/Teams from [person]" --due "YYYY-MM-DD" --category work
```
The output JSON includes the `task_id` and `things3_uuid`. Use the `task_id` in the briefing checkbox text so `/check-briefing` can complete the task deterministically:
```markdown
- [ ] Review ADO report from Tanvi (Task ID: AI-20260421-082145)
```

To add items for the waiting-on-others direction:
```sh
$ATLAS commit add --title "What they owe" --direction theirs --person "Person Name" --source "meeting/2026-04-24" --due "ASAP" --channel email --category work
```

The `--category` flag on `commit add` maps to Things 3 areas automatically (work→Work, personal→Personal, church→Church, hmbl→HMBL).

### Complete done tasks
If yesterday's journals or overnight data show something was completed that's still active in the DB:
```sh
$ATLAS commit complete --task-id "AI-..."
```
This marks it done in the DB, pushes the completion to Things 3, and re-renders markdown.

### Reassess tags (optional)
After adding/completing tasks, tags on Things 3 tasks may need updating. Use the Things 3 scripts directly for tag management:

1. **`urgent`**: Apply to tasks due today or overdue. Check: `$ATLAS commit overdue` for overdue items.
2. **`action-item`**: Apply to all tasks that exist in the DB with direction=mine.
3. **`blocked`**: Apply to tasks where Derek is waiting on someone else. Check: `$ATLAS commit list --direction theirs --status active`.

Use `~/.local/bin/things3/update.sh <id> --tags "tag1,tag2"` for tag updates. To find task IDs: `~/.local/bin/things3/search.sh "keyword"`.

Remove stale tags from completed or resolved items. Tags should reflect the current state, not yesterday's.

### Report
Present: "Added X tasks, completed Y tasks, updated tags on Z tasks" with the list.

## Step 5: Update files

**Update `/memories/priorities.md`:**
- Replace "Tomorrow's Meetings" with today's actual meeting list
- Add any new action items surfaced from overnight activity
- Remove items that were completed yesterday
- Only change what's clearly warranted

**Action items and waiting-on-others are updated automatically** by the `$ATLAS commit add/complete/nudge` commands in Step 4. Every mutation re-renders `assistant/data/context/action-items.md` and `assistant/data/context/waiting-on-others.md`. Do NOT manually edit these files.

**If you discover new overdue items** (items in the DB with past due dates that haven't been flagged), the rendered markdown already marks them with "(OVERDUE)" automatically.

## Step 6: Surface conflicts or suggestions

- Flag any scheduling conflicts or overloaded days
- Note if a priority from yesterday hasn't moved in several days
- Suggest 1-2 things to tackle, defer, or delegate
- If a meeting today involves someone who owes you something, suggest raising it

Append the Phase B report (task sync + conflicts) to the briefing file already saved.

## Checkpoint System

The briefing uses a checkpoint system to track which items have been processed:
- **checkpoint_id**: Unique ID for today's briefing (format: `AI-YYYYMMDD-HHMMSS`)
- **checkpoint_state**: Hidden comment tracking checkbox state changes

When Derek runs `/check-briefing`, the system:
1. Reads the current briefing
2. Compares to last checkpoint state (stored in `~/.checkpoints/YYYY-MM-DD.json`)
3. Detects newly-checked items
4. Completes matching Things 3 tasks by Task ID
5. Saves new checkpoint state

Scheduled syncs (midday, EOD) won't reprocess items already handled by `/check-briefing` because checkpoint state prevents duplicates. This is idempotent—running `/check-briefing` multiple times won't create duplicate completions.

## Gotchas

Hard-won lessons. Check here before debugging.

| Issue | Fix |
|-------|-----|
| WorkIQ call returns partial or empty data | Retry ONCE. If still empty, proceed without it and note "⚠️ WorkIQ unavailable" in briefing. Never block the whole routine. |
| Things 3 `search.sh` matches wrong task (substring match) | Use `$ATLAS commit complete --task-id AI-...` which matches by exact Task ID in the DB. Only fall back to Things 3 keyword search when no ID exists. |
| Terminal command hangs with timeout=0 | Always set explicit timeouts: 10s for quick ops, 30s for batch ops. Never use timeout=0. |
| JSON and markdown briefings drift out of sync | Every checkbox item in the .md MUST have a matching entry in the .json. The `id` field is the link. Generate both from the same data in Step 3/3b. |
| Triage creates tasks for FYI emails with no actual ask | Apply the 5-point action item extraction tests (explicit ask, announcement filter, meeting prep, group ask, unaccepted offer) before creating any task. |
| Access requests appear in briefing | Hard exclusion. Filter silently, never surface in any section. |
| Draft confidence scoring saves a draft Derek didn't want | Never auto-send. Outlook's send button is the gate. Log all auto-drafts to `assistant/data/state/auto-drafts.log`. |
| Parallel tool calls include WorkIQ + shell + MCP in same batch | Correct. These are independent. Do not serialize them. |
| Contact lookup fails because filename doesn't match display name | Read `index.json` first to get the name-to-file mapping. Match on name, aliases, or email. |
| Meeting brief ledger `claim` returns non-zero | The rolling sweep already produced a brief. Skip generation and reference the existing path. |
| atlas-db commit add fails with "task_id already exists" | The item is already tracked. Use `$ATLAS commit search` to find it. |
| Briefing shows wrong day-of-week (e.g. Sunday instead of Monday) | LLMs cannot reliably compute day-of-week from date strings. Always run `date '+%A %B %d, %Y'` in a terminal as the first step. Never derive it yourself. |
