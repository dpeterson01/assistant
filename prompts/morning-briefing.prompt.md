---
name: morning-briefing
description: "Start the day with a briefing across work, personal, and church contexts. Use when: good morning, start my day, what's on my plate, morning briefing, daily briefing, what do I have today, brief me."
agent: "agent"
argument-hint: "Optional: specific context to focus on (work, personal, church)"
---

# Morning Briefing

You are Derek's AI partner. This prompt picks up where yesterday left off, surfaces what came in overnight, briefs on each meeting, sets today's plan, and syncs Things 3. Move fast.

Read `/memories/identity.md`, `/memories/priorities.md`, `/memories/action-items.md`, and `/memories/waiting-on-others.md` first.

## Step 1: Reload context (do all in parallel where possible)

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

### Overnight activity and today's meetings
Use `mcp_workiq_ask_work_iq`:

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

### Meeting briefings (per-meeting deep context)
After getting the meeting list, build a briefing for each meeting. For every meeting today, use `mcp_workiq_ask_work_iq` to gather signals. You may batch 2-3 meetings per query if attendees overlap, but cover every meeting.

For each meeting, query:

> I have a meeting: **[Meeting Title]** at [time] with [attendee names].
>
> Search the last 14 days for anything relevant to this meeting:
> 1. **Emails** to/from/cc any attendee, or about topics likely on the agenda
> 2. **Teams messages** (1:1 or group chats) with any attendee
> 3. **Teams channel posts** in channels these attendees are active in
> 4. **Prior instances of this meeting**: If this is a recurring meeting (1:1, standup, sync, review, office hours), find the most recent 1-2 prior occurrences. Surface any follow-up items, action items, or decisions from those prior meetings that are still open or relevant.
> 5. **Documents or links shared** by any attendee in the past 14 days
>
> For each signal found, provide: source type (email/Teams/doc/prior-meeting), who, when, and a 1-sentence summary of what was said or shared.
> For prior meeting follow-ups specifically, note whether the item appears resolved or still open.

Then cross-reference each meeting's signals against:
- `/memories/action-items.md`: Does Derek owe anything to an attendee?
- `/memories/waiting-on-others.md`: Does an attendee owe Derek something?
- Yesterday's journal `Open Threads`: Any unresolved items involving these people?

Assemble each meeting briefing with this structure:
```
### [Meeting Title] (time, duration)
**Attendees**: [names, roles if known]
**Agenda**: [from invite, or inferred from signals, or "None provided"]
**Signals**:
- [source type] [who] [when]: [1-sentence summary]
- [source type] [who] [when]: [1-sentence summary]
**Open items with attendees**:
- [item from action-items/waiting-on-others, or "None"]
**Suggested talking points**:
- [1-2 specific things Derek should raise, ask about, or follow up on based on signals and open items]
**Prep**: [specific action needed before this meeting, or "None"]
```

For recurring standups or office hours with no signals, keep the briefing minimal: attendees, "Recurring standup, no specific prep needed."

### iMessages (overnight and recent unread)
Use `mcp_imcp_messages_fetch` to check for messages since 5pm yesterday. Also check today's personal journal if the overnight script captured iMessages there.

### Triage all inbound communications
After collecting emails, Teams, and iMessages, classify every item using these rules:

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

**Action item extraction**: For every HIGH or MEDIUM item, determine: does this require Derek to DO something? If yes, it becomes a task. Extract: what to do, who it's owed to, source, and deadline (explicit or inferred).

### Current priorities and action items
Read `/memories/priorities.md`, `/memories/action-items.md`, and `/memories/waiting-on-others.md`.

If any source fails, note it and continue.

## Step 2: Brief Derek

Present a tight morning briefing. No fluff.

### What carried over from yesterday
- Unresolved threads and action items from yesterday's journals
- Items in action-items.md that are overdue or due today

### What came in overnight (triaged)
Present communications grouped by importance tier. For each item show the tier emoji, source (email/Teams/iMessage), sender, age if older than overnight, and 1-sentence summary.

**🔴 HIGH** items first (these need action, briefly state what Derek needs to do)
**🟡 MEDIUM** items next
**🟢 LOW** items: just a count ("X low-priority items, nothing actionable")

If there are unread items from prior days, call them out: "N unread items aged 2+ days, escalated."

### Today's meetings
Present the full meeting briefings assembled in Step 1, in chronological order. For each meeting show:
- **Title** (time) with key attendees
- **Why it matters today**: 1-2 sentences synthesizing the signals, agenda, and open items
- **Signals**: The most relevant 2-3 signals (skip if routine standup with nothing notable)
- **Raise this**: Specific things Derek should bring up (from open items, waiting-on-others, or signal context). If an attendee owes Derek something, say so directly.
- **Prep**: What to review or prepare before this meeting, or "None"

For low-signal recurring meetings (standups, office hours), compress to one line: "**Title** (time) - Recurring, no specific prep."

### Accountability check
- **My overdue items**: From `/memories/action-items.md`, items past due or due today. Be direct.
- **Waiting on others**: From `/memories/waiting-on-others.md`, items past due or stale (5+ business days, no nudge). For each:
  - If they're in a meeting today: "Bring up [item] with [person] in [meeting name]"
  - If overdue and not recently nudged: "Consider running `/nudge [person]` to follow up"
  - Count: "X items pending from others, Y overdue"

### Today's tasks
- Things 3 Today list items
- Suggested priorities: rank the top 3 things to focus on today, considering meetings, carry-forward items, deadlines, and action items

### Upcoming (next 2-3 days)
- Deadlines approaching
- Things 3 Upcoming items worth noting

## Step 3: Sync Things 3

Every action item identified during triage becomes a Things 3 task. No exceptions for HIGH items. MEDIUM items become tasks if they have a clear "do" action.

### Sources that generate tasks
1. 🔴 HIGH communications (email, Teams, iMessage) with an action for Derek
2. 🟡 MEDIUM communications with a clear, specific ask
3. Carry-forward items from yesterday's journal not yet in Things 3
4. Meeting prep tasks (from Step 2 meeting briefs)
5. New items added to `action-items.md`

### Before adding, always deduplicate
Search first (`~/.local/bin/things3/search.sh "keyword"`) for each candidate. Skip if a matching task exists.

### Add missing tasks
```sh
~/.local/bin/things3/add.sh "Task title" --when "YYYY-MM-DD" --notes "Source: [email/Teams/iMessage] from [person]. Context: [1 sentence]." --tags "action-item"
```
Then immediately move to the correct project:
```sh
~/.local/bin/things3/move.sh --search "Task title" "Project Name"
```

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

### Reassess tags
After adding/completing tasks, reassess tags on all Today tasks:

1. **`urgent`**: Apply to tasks due today, overdue, or HIGH-triage items with same-day deadlines. Remove from tasks no longer time-sensitive.
2. **`action-item`**: Apply to all tasks that exist in `/memories/action-items.md`. Remove if the item was completed or removed from action-items.
3. **`blocked`**: Apply to tasks where Derek is waiting on someone else (cross-reference `/memories/waiting-on-others.md`). Remove when the blocker resolves.

Use `~/.local/bin/things3/update.sh <id> --tags "tag1,tag2"` to set tags. To find task IDs: `~/.local/bin/things3/search.sh "keyword"`.

Remove stale tags from completed or resolved items. Tags should reflect the current state, not yesterday's.

### Report
Present: "Added X tasks, completed Y tasks, updated tags on Z tasks" with the list. For each added task, show the source (e.g., "from email: Tanvi re: Epic Change Report").

## Step 4: Surface conflicts or suggestions

- Flag any scheduling conflicts or overloaded days
- Note if a priority from yesterday hasn't moved in several days
- Suggest 1-2 things to tackle, defer, or delegate
- If a meeting today involves someone who owes you something, suggest raising it

## Step 5: Update files

**Update `/memories/priorities.md`:**
- Replace "Tomorrow's Meetings" with today's actual meeting list
- Add any new action items surfaced from overnight activity
- Remove items that were completed yesterday
- Only change what's clearly warranted

**Update `/memories/action-items.md`:**
- Add any new items (mine) discovered from overnight emails/Teams
- Mark completed items (move to Completed section with date)
- Prune the Completed section to last 7 days only
- Flag overdue items by adding "(OVERDUE)" to the line

**Update `/memories/waiting-on-others.md`:**
- Add any new commitments others made in overnight emails/Teams
- Mark resolved items (move to Resolved section with date)
- Prune the Resolved section to last 14 days
- Flag overdue items by updating Status to "overdue"
- Flag stale items (5+ business days, never nudged) by updating Status to "stale"

Keep the whole briefing under 50 lines. Lead with what matters most.

## Step 6: Save the briefing

Save the full briefing output to `~/projects/personal/assistant/briefings/YYYY-MM-DD_daily_brief.md` where YYYY-MM-DD is today's date.

The file should contain:
- A YAML frontmatter block with `date`, `meetings_count`, `action_items_count`, `high_priority_count`
- The complete briefing as presented to Derek (Steps 2-4 output)
- A `## Tasks Synced` section with the Step 3 report

This archive enables cross-day pattern recognition (e.g., items appearing in multiple briefings without resolution) and provides continuity for future morning briefings.
