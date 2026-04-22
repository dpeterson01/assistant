---
name: morning-briefing
description: "Start the day with a briefing across work, personal, and church contexts. Use when: good morning, start my day, what's on my plate, morning briefing, daily briefing, what do I have today, brief me."
agent: "agent"
argument-hint: "Optional: specific context to focus on (work, personal, church)"
---

# Morning Briefing

You are Derek's AI partner. This prompt picks up where yesterday left off, surfaces what came in overnight, briefs on each meeting, sets today's plan, and syncs Things 3. Move fast.

## How Checkboxes Work

Every actionable item in the briefing gets a checkbox: `- [ ]`. Derek can check items as he completes them throughout the day. When ready to push completions immediately to Things 3 and action-items (instead of waiting for midday sync), he runs:
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

Read `/memories/identity.md`, `/memories/priorities.md`, `/memories/action-items.md`, and `/memories/waiting-on-others.md` first. Hold these in context for the entire briefing. Do not re-read them in later steps.

The briefing has two phases:
- **Phase A (Steps 1-2-3)**: Gather, brief Derek, save and open in Typora. Get Derek reading ASAP.
- **Phase B (Steps 4-5-6)**: Maintenance. Sync Things 3, update memory files, surface conflicts. Runs while Derek reads.

---

# Phase A: Get the briefing to Derek fast

## Step 1: Reload context (do all in parallel where possible)

### Recent briefings (primary context source)
Check if any briefings exist: `ls ~/projects/personal/assistant/briefings/ 2>/dev/null | head -1`

**If briefings exist**: Read the last 3-5 daily briefings (most recent by date). Use `ls -t ~/projects/personal/assistant/briefings/ | head -5`. Extract:
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

### iMessages (weekends and personal context only)
On weekdays, skip the iMessage fetch. Today's personal journal already has overnight iMessages if the generate script ran. Only use `mcp_imcp_messages_fetch` on weekends or if explicitly asked.

### Triage all inbound communications
After collecting emails and Teams, classify every item using these rules:

**🔴 HIGH (surface first, add to Things 3)**
- From Heather, Curtis, or direct reports with a direct ask or decision needed
- Contains a deadline today or this week
- Matches an active item in `action-items.md` or `waiting-on-others.md`
- Someone delivering something Derek is waiting on
- Meeting prep needed within 24 hours
- **Aging boost**: unread items 2+ business days old automatically escalate one tier

**🟡 MEDIUM (review today)**
- Cross-team partners on active initiatives (Shayne, Kay, Mandy, Sonia, Mark, Daniel, etc.)
- FYI threads where Derek is explicitly cc'd with context he needs
- Responses to threads Derek started
- **Aging boost**: unread items 3+ business days old escalate to HIGH

**🟢 LOW (batch later or skip)**
- Broad distribution, no action for Derek
- Informational channel posts with no ask
- Social/casual messages
- **Aging boost**: unread items 5+ business days old escalate to MEDIUM

**Action item extraction**: For every HIGH or MEDIUM item, determine: does this require Derek to DO something? Apply these tests before creating a task:
1. **Explicit ask test**: Is there a direct request, question, decision, or deliverable addressed to Derek — using language like "can you", "please", "I need you to", "your thoughts on", or similar? If no explicit ask is present, do not create a task. Sharing a link, article, resource, or suggestion without a clear ask does not qualify. Derek will encounter it in his inbox when he reviews it. "You might find this interesting" or "check this out" are not asks.
2. **Announcement filter**: Kickoff emails, announcements, FYIs, and updates where Derek is on the To: or Cc: line but has no named role or ask → do not create a task. These belong in briefing context only.
3. **Meeting prep exception**: If the email is directly relevant to a meeting today and Derek has no existing prep item for that meeting, a single "Review [topic] before [meeting]" task is acceptable — but only if the meeting has no prior prep entry in Things 3.
4. **Group meeting ask filter**: For requests or asks that surface in meetings or chat threads with more than one participant, only create a task if: (a) the request explicitly @mentions Derek by name or alias, AND (b) there is no visible response from Derek or anyone else already addressing the request. If someone asks a group for something and no one is specifically assigned to Derek, do not create a task — even if Derek could theoretically fulfill the ask.
5. **Unaccepted offer filter**: If Derek volunteered or offered to help during a meeting or conversation but there is no explicit acceptance, confirmation, or follow-up from the other person, do not create a task. An offer Derek made that has not been accepted is not a commitment.

If a task passes these tests, extract: what to do, who it's owed to, source, and deadline (explicit or inferred).

## Step 2: Brief Derek

Present a tight morning briefing. No fluff.

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
- **My overdue items**: From `/memories/action-items.md`, items past due or due today. Prefix each with `- [ ]` checkbox. Be direct.
- **Waiting on others**: From `/memories/waiting-on-others.md`, items past due or stale (5+ business days, no nudge). For each:
  - If they're in a meeting today: `- [ ]` "Bring up [item] with [person] in [meeting name]"
  - If overdue and not recently nudged: "Consider running `/nudge [person]` to follow up"
  - Count: "X items pending from others, Y overdue"

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

Save the full briefing output to `~/projects/personal/assistant/briefings/YYYY-MM-DD_daily_brief.md` where YYYY-MM-DD is today's date.

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
open -a Typora ~/projects/personal/assistant/briefings/YYYY-MM-DD_daily_brief.md
```

Then continue to Phase B while Derek reads.

---

# Phase B: Maintenance (runs while Derek reads the briefing)

## Step 4: Sync Things 3

Every action item identified during triage becomes a Things 3 task. No exceptions for HIGH items. MEDIUM items become tasks if they have a clear "do" action.

### Sources that generate tasks
1. 🔴 HIGH communications (email, Teams) with an action for Derek
2. 🟡 MEDIUM communications with a clear, specific ask
3. Carry-forward items from yesterday's journal not yet in Things 3
4. Meeting prep tasks (from Step 2 meeting briefs)
5. New items added to `action-items.md`

### Batch deduplication
Before adding tasks, run a single search for all candidate keywords at once to minimize shell calls:
```sh
~/.local/bin/things3/search.sh "keyword1\|keyword2\|keyword3"
```
Skip any candidate that already has a matching task.

### Add missing tasks (batch when possible)
For each task to add, mint a stable task ID first:
```sh
TASK_ID=$(~/.local/bin/things3/new-id.sh)
~/.local/bin/things3/add.sh "Task title" --when "YYYY-MM-DD" --notes "Source: [email/Teams] from [person]. Context: [1 sentence]." --task-id "$TASK_ID" --tags "action-item"
```
Then move to the correct project:
```sh
~/.local/bin/things3/move.sh --search "Task title" "Project Name"
```
Include `Task ID: $TASK_ID` in any related memory/action-item entry so completion can be matched deterministically.

**Important**: Include the Task ID in the briefing checkbox text so `/check-briefing` can complete the task:
```markdown
- [ ] Review ADO report from Tanvi (Task ID: AI-20260421-082145)
```
When Derek checks this box and runs `/check-briefing`, the system finds the Things 3 task by ID and completes it automatically.

Every task must live in a project. See the Things 3 skill (`/things3`) for full project routing. Quick reference:
- **Work**: Agent Skills, Learn Platform Operations, Operational, People & Growth, Process improvements
- **Personal**: Family & Admin, Household Projects, Insurance, Vehicles
- **HMBL**: Wind-Down
- **Church**: Track 1-4 (see skill for full names)

- Set `--when` to the deadline if known, otherwise today
- For HIGH items with tight deadlines, add `--tags "action-item,urgent"`

### Complete done tasks
If yesterday's journals or overnight data show something was completed that's still open in Things 3:
```sh
~/.local/bin/things3/complete.sh --search "task keyword"
```

### Reassess tags (batch)
After adding/completing tasks, reassess tags on all Today tasks in a single pass:

1. **`urgent`**: Apply to tasks due today, overdue, or HIGH-triage items with same-day deadlines. Remove from tasks no longer time-sensitive.
2. **`action-item`**: Apply to all tasks that exist in `/memories/action-items.md`. Remove if the item was completed or removed from action-items.
3. **`blocked`**: Apply to tasks where Derek is waiting on someone else (cross-reference `/memories/waiting-on-others.md`). Remove when the blocker resolves.

Use `~/.local/bin/things3/update.sh <id> --tags "tag1,tag2"` to set tags. To find task IDs: `~/.local/bin/things3/search.sh "keyword"`.

Remove stale tags from completed or resolved items. Tags should reflect the current state, not yesterday's.

### Report
Present: "Added X tasks, completed Y tasks, updated tags on Z tasks" with the list.

## Step 5: Update files

**Update `/memories/priorities.md`:**
- Replace "Tomorrow's Meetings" with today's actual meeting list
- Add any new action items surfaced from overnight activity
- Remove items that were completed yesterday
- Only change what's clearly warranted

**Update `/memories/action-items.md`:**
- Add any new items (mine) discovered from overnight emails/Teams
- Include `Task ID: AI-...` for each new item that was created in Things 3
- Mark completed items (move to Completed section with date)
- Prune the Completed section to last 7 days only
- Flag overdue items by adding "(OVERDUE)" to the line

**Update `/memories/waiting-on-others.md`:**
- Add any new commitments others made in overnight emails/Teams
- Mark resolved items (move to Resolved section with date)
- Prune the Resolved section to last 14 days
- Flag overdue items by updating Status to "overdue"
- Flag stale items (5+ business days, never nudged) by updating Status to "stale"

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
