---
name: morning-briefing
description: "Start the day with a briefing across all life contexts. Use when: good morning, start my day, what's on my plate, morning briefing, daily briefing, what do I have today, brief me."
agent: "agent"
argument-hint: "Optional: specific context to focus on (e.g., work, personal)"
---

# Morning Briefing

You are the user's AI partner. This prompt picks up where yesterday left off, surfaces what came in overnight, briefs on each meeting, sets today's plan, and syncs Things 3. Move fast.

Follow the shared preamble in `.instructions.md` for setup, execution rules, and gotchas.

**Read config first**: Read `data/config.yaml` (relative to the assistant root). This defines:
- **Categories**: the user's life contexts (e.g., work, personal, church). Each maps to a Things 3 Area.
- **Channels**: email accounts and messaging platforms with MCP tool prefixes.
- **Journals**: paths for each category's daily journal files.
- **Contacts**: paths to contact index files.
Use these throughout the briefing instead of hardcoded values.

The briefing has two phases:
- **Phase A (Steps 1-2-3)**: Gather, brief the user, save and open. Get the user reading ASAP.
- **Phase B (Steps 4-5)**: Maintenance. Sync Things 3, update memory files, surface conflicts. Runs while the user reads.

---

# Phase A: Get the briefing to the user fast

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
If today is Monday (or the most recent daily briefing is 3+ days old), also read the most recent weekly review from each journal path defined in config (check for a `weekly/` subdirectory alongside the daily journals).

### Yesterday's close-out
Read `~/.local/share/daily-consolidation/last-session.txt` to get the last end-of-day date.
Read that date's journals from each path in config's `journals` section (substitute the date into the strftime pattern).

Extract: open threads, action items, "tomorrow" suggestions, anything unresolved.

If the file doesn't exist or there was no end-of-day session, read the most recent journal from each path instead.

### Today's existing data
Read today's journals if they exist (the generate script may have already created journals with iMessage/email data overnight). Check each path in config's `journals` section.

### Things 3 — what's already queued
Run both in terminal:
- `~/.local/bin/things3/today.sh` (today's task list)
- `~/.local/bin/things3/upcoming.sh` (next 7 days)

### Additional life contexts
For each category beyond work defined in config (e.g., personal, church, community), check for relevant activity:

**Data sources** (check all, in parallel with other Step 1 sources):
- **Things 3**: `~/.local/bin/things3/by-tag.sh <category>` and search for tasks related to that context
- **Priorities**: The relevant section in `/memories/priorities.md` lists active commitments
- **Email channels**: For each channel in config mapped to this category, search recent emails using the channel's MCP prefix. Limit to last 7 days.
- **iMessages**: Check for messages from contacts related to this context listed in `/memories/identity.md`. Use `mcp_mac-messages_tool_fuzzy_search_messages` with relevant names.
- **Journals**: Check the category's journal path from config for existing entries.

**Include in briefing when**:
- There are open church tasks in Things 3 (always surface)
- Church items in priorities.md have approaching deadlines or are overdue
- Overnight email/iMessage activity involves church contacts
- A church event or meeting is on the calendar today

**Briefing placement**: Church items appear in the appropriate sections (carry-over, tasks, accountability) alongside work and personal items. Tag them with "🏛️" prefix so the user can scan. On weekends, promote church items higher since work items are typically lower priority.

**Things 3 routing**: Church tasks go to the appropriate Church project (Track 1-4). See the Things 3 skill for project names.

### Upcoming birthdays
Run in terminal:
- `~/.local/bin/contacts/birthdays.sh 14` (next 14 days)

Surface any birthdays happening today, tomorrow, or this week. If a birthday contact is also a meeting attendee today, flag it in their meeting briefing as both a `peopleContext` entry (type: `birthday`) AND a signal (source: `contact`) so it appears on the dashboard.

### Overnight activity and today's meetings
Gather meetings, emails, and Teams activity. Start with the direct MCP tools (historically more reliable), then enrich with WorkIQ if available.

#### Step A: Calendar and email (primary)
Run these two calls in parallel:
1. **Meetings**: `mcp_calendartools_ListCalendarView` with today's date range (start: `YYYY-MM-DDT00:00:00`, end: `YYYY-MM-DDT23:59:59`).
2. **Overnight emails**: `mcp_mailtools_SearchMessages` with query `received:yesterday..now` (or equivalent date filter) to get recent emails. Exclude marketing, newsletters, automated notifications, mass distribution.

#### Step B: WorkIQ enrichment (optional, often unavailable)
If `mcp_workiq_ask_work_iq` is available, make ONE call to enrich with Teams activity and any details the direct tools missed:

> Give me everything I need to start my day for YYYY-MM-DD.
>
> **Overnight activity (since 5pm yesterday):**
> - Teams messages and channel activity
> - Any emails or meetings not already covered
>
> **Unread items from prior days:**
> - Any unread Teams messages from the past 3 days
>
> Format Teams as: **Chat/Channel** | From: [name] | Summary: [1 sentence]

If WorkIQ fails or is unavailable, note "⚠️ Teams activity unavailable (WorkIQ down)" and proceed. Do not block the briefing on WorkIQ.

### Build meeting briefings (from briefing archive + overnight data)
For each meeting today, assemble a briefing by combining:

1. **Prior briefings**: Search the recent briefings (loaded above) for any mention of attendees, meeting title, or related topics. Extract prior signals, open follow-ups, and unresolved items.
2. **Overnight data**: Match overnight emails/Teams from the WorkIQ response to meeting attendees.
3. **Memory files** (already loaded): Cross-reference action-items.md (does the user owe an attendee?) and waiting-on-others.md (does an attendee owe the user?).
4. **Contacts directory**: For each contacts path in config, read the `index.json` once to get the name-to-file mapping. For each attendee, look up their entry in the index (match on name, aliases, or email). Read matching contact files and extract context that matters *for this specific meeting today*:
   - **Birthday**: If today/tomorrow/this week, always flag it (source: `contact`)
   - **Working style**: Only include traits relevant to this meeting's likely dynamics (e.g., "prefers data-driven arguments" for a decision meeting, "sensitive to PM dictating" for a cross-functional sync)
   - **History**: Last interaction date and summary. Especially important for 1:1s (how long since last sync?) and for people the user hasn't met with recently.
   - **Watch-out-for**: Any patterns, sensitivities, or dynamics noted in the contact file
   - **Personal**: Recently promoted, returned from leave, new to team, etc.
   Route these into the JSON `peopleContext` array (see dashboard-json-schema.md) AND into `signals` when they're actionable (e.g., birthday today → signal with source `contact`).
5. **Yesterday's journal**: Open threads involving these people.

Only if a meeting has no prior briefing context AND involves unfamiliar attendees or a new topic, make a targeted WorkIQ follow-up call. This should be rare.

Assemble each meeting briefing with this structure:
```
### [Meeting Title] (time, duration)
**Attendees**: [names, roles if known]
**Agenda**: [from invite, or inferred from signals, or "None provided"]
**Why it matters today**: [1-2 sentences synthesizing all signals into why this meeting is important right now]
**Signals**:
- [source] [who]: [One specific sentence with context. NOT a topic label. Include what happened, what it means, and why it's relevant to this meeting.]
**Open items with attendees**:
- [item from action-items/waiting-on-others/prior briefings, with specific details: what's owed, by whom, since when, and what "done" looks like. Or "None"]
**Suggested talking points**:
- [Topic]: [What specifically to say or ask, with enough context that the user can raise it cold without looking anything up. Reference specific artifacts, dates, names, or commitments.]
**Prep**: [specific action needed, or "None"]
```

**Quality bar for signals and talking points**: Every signal and talking point must pass the "could the user act on this without opening another window?" test. If a signal just names a topic (e.g., "DSB/RAI thread active") without explaining what happened and why it matters, it's too vague. If a talking point just names a subject (e.g., "LiveSite status") without saying what to ask or say, rewrite it.

For recurring standups or office hours with no signals, compress to one line: "**Title** (time) - Recurring, no specific prep."

### Write per-meeting brief files (high-stakes meetings only)

In addition to the inline briefing assembled above, write a deeper standalone brief for each **high-stakes** meeting. A meeting is high-stakes if any of these are true:
- ≥1 external attendee (different domain than the user's employer domain)
- Title matches `1:1`, `sync`, `review`, `decision`, `interview`, `leadership`, `debrief`, `prep`, or `kickoff` AND duration ≥ 25 minutes
- the user owes someone in the meeting an action item (per `action-items.md`)
- Someone in the meeting owes the user something overdue (per `waiting-on-others.md`)

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

## Step 2: Brief the user

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

Assemble carryOver candidates from:
- Unresolved threads and action items from yesterday's journals
- Items in action-items.md that are overdue or due today
- Open items from prior briefings that haven't been resolved

**Hard filter (mandatory before display):** Query the DB for all recently completed items:
```sh
$ATLAS commit list --status completed
```
Remove any candidate whose title matches a completed commitment. This prevents items completed mid-day (after the briefing was written but before EOD) from reappearing the next morning via journal or prior-briefing references. Do not skip this step even if the tool call fails; if it fails, note "⚠️ Could not verify completions, carryOver may include resolved items" at the top of this section.

**Display**: Prefix each surviving item with `- ` (plain bullet, no checkbox). Use `✅` prefix for items already completed.

### What came in overnight (triaged)
Present communications grouped by importance tier. For each item show the tier emoji, source (email/Teams), sender, age if older than overnight, and 1-sentence summary.

**🔴 HIGH** items first (include Task ID if created in Things 3; briefly state what the user needs to do)
**🟡 MEDIUM** items next (include Task ID for actionable ones)
**🟢 LOW** items: just a count ("X low-priority items, nothing actionable")

If there are unread items from prior days, call them out: "N unread items aged 2+ days, escalated."

### Today's meetings
Present the full meeting briefings assembled in Step 1, in chronological order. For each meeting show:
- **Title** (time) with key attendees
- **Why it matters today**: 1-2 sentences synthesizing the signals, agenda, and open items
- **Signals**: The most relevant 2-3 signals with full context: source, who, and a sentence explaining what happened and why it matters for this meeting. Not topic labels.
- **Raise this**: Specific things the user should bring up, written as complete talking points he can use directly. Include what to say/ask, reference specific artifacts or dates, and explain why now. If an attendee owes the user something, state exactly what, since when, and what "done" looks like.
- **Prep**: Note if the user needs to prep before this meeting, else "None"

For low-signal recurring meetings (standups, office hours), compress to one line: "**Title** (time) - Recurring, no specific prep."

### Accountability check
- **My overdue items**: Run `$ATLAS commit overdue` to get all overdue items. Surface items where direction=mine. Be direct.
- **Waiting on others**: Run `$ATLAS commit list --direction theirs --status active` to get active items others owe the user. For each active item:
  - If they're in a meeting today: "Bring up [item] with [person] in [meeting name]"
  - If overdue and not recently nudged: "Consider running `/nudge [person]` to follow up"
  - Count: "X items pending from others, Y overdue"
- **Auto-nudge candidates**: Items where `daysOpen >= 5` AND `last_nudge` is null or older than 3 days are auto-nudge candidates. For each:
  - Set `stale: true` in the JSON `accountability.waitingOn` entry
  - Append: "⏰ Stale 5+ days. Run `/nudge [person]` or use the dashboard nudge button."
  - If the person is in a meeting today, prefer the in-meeting approach over a nudge message.

### Birthdays
If any birthdays are coming up in the next 7 days, list them. Today/tomorrow birthdays get a 🎂 callout. If a birthday person is a meeting attendee or direct report, suggest acknowledging it.

### Weekly objectives and daily MITs

**Read current objectives:**
```sh
$ATLAS objective list
```

**Monday — Weekly Kickoff:**
If today is Monday, this is the weekly kickoff. The objectives set during Sunday's weekly review are in "proposed" status. Present them:

> 🎯 **Weekly Objectives (proposed)**
> 1. [objective 1]
> 2. [objective 2]
> 3. [objective 3]
>
> Confirm, edit, or swap? Once confirmed, I'll activate them for the week.

After the user confirms (or edits), promote to active:
```sh
$ATLAS objective set --rank 1 --title "Confirmed objective 1" --context work --status active
$ATLAS objective set --rank 2 --title "Confirmed objective 2" --context work --status active
$ATLAS objective set --rank 3 --title "Confirmed objective 3" --context personal --status active
```

If it's Monday after 11:00 AM and objectives are still "proposed" (user ran briefing late), auto-promote them without asking: the user already approved them during Sunday review.

**Tuesday-Friday — Objectives Banner:**
Show a compact objectives banner (already active, no confirmation needed):

> 🎯 **This week's objectives**: 1) [obj1] 2) [obj2] 3) [obj3]

**Daily MITs (every day including Monday):**
After confirming objectives (Monday) or showing the banner (Tue-Fri), suggest 3 MITs: the Most Important Tasks for today. Select them by:
1. Tasks that directly advance an active objective
2. Overdue commitments from accountability
3. HIGH items with deadlines today
4. Meeting prep needed in the next 4 hours

Present as:
> **Today's MITs** (propose, then confirm):
> 1. [MIT 1] — advances objective #1
> 2. [MIT 2] — overdue commitment
> 3. [MIT 3] — advances objective #2

After user confirms (or edits):
```sh
$ATLAS mit set --rank 1 --title "MIT 1 text" --objective-id "OBJ-2026W20-1"
$ATLAS mit set --rank 2 --title "MIT 2 text"
$ATLAS mit set --rank 3 --title "MIT 3 text" --objective-id "OBJ-2026W20-2"
```

### Today's tasks
- List each Things 3 Today item
- The top 3 should align with the MITs above. Other tasks are supporting work.
- **Overload check**: If Today has more than 30 items, flag it prominently: "⚠️ Today list has [N] items. That's too many to realistically complete. Recommend moving lower-priority items to Anytime or rescheduling to specific future dates." Then suggest 5-10 items to defer, picking items without deadlines or external commitments first.

### Upcoming (next 2-3 days)
- Deadlines approaching
- Things 3 Upcoming items worth noting

Keep the briefing under 50 lines (excluding the objectives/MIT confirmation exchange). Lead with what matters most.

## Step 3: Save briefing JSON and open dashboard

Save a structured JSON file to `~/projects/personal/assistant/data/briefings/YYYY-MM-DD_daily_brief.json`. This powers the interactive dashboard at `http://localhost:3141`.

Build the JSON from the same data gathered in Steps 1-2. Follow the schema defined in [dashboard-json-schema.md](../context/dashboard-json-schema.md), which specifies:
- Top-level structure (dayFit, carryOver, inbox, meetings, tasks, accountability, upcoming)
- Per-item fields and deep link fields
- Meeting fields and high-stakes criteria
- Accountability structure

The `carryOver` array must only contain items that survived the hard filter in Step 2 (i.e., not present in the DB as completed). Do not re-derive carryOver from raw sources for the JSON; use the same filtered list.

Also save a human-readable markdown render to `~/projects/personal/assistant/data/briefings/YYYY-MM-DD_daily_brief.md`. This is a **disposable render** of the JSON for quick reading. It does not need frontmatter, checkpoint IDs, or hidden state comments. Just the briefing content from Step 2.

### Open the dashboard
After saving the JSON, ensure the dashboard server is running and open it:
```sh
# Start the server if it's not already running
if ! curl -sf http://localhost:3141/api/briefing > /dev/null 2>&1; then
  cd ~/projects/personal/assistant/dashboard && node server.js &
  sleep 1
fi
open -a "Microsoft Edge" http://localhost:3141
```

---

# Phase B: Maintenance (runs while the user reads the briefing)

## Step 4: Sync Things 3

Every action item identified during triage becomes a Things 3 task. No exceptions for HIGH items. MEDIUM items become tasks if they have a clear "do" action.

### Sources that generate tasks
1. 🔴 HIGH communications (email, Teams) with an action for the user
2. 🟡 MEDIUM communications with a clear, specific ask
3. Carry-forward items from yesterday's journal not yet in the DB
4. Meeting prep tasks (from Step 2 meeting briefs)

**Never create tasks for**: GitHub pull requests or code reviews (PRs). Surface PR review requests in the briefing as informational items only — do not add them to Things 3 or action-items.md.

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
The output JSON includes the `task_id` and `things3_uuid`. Use the `task_id` in the briefing so completions can be tracked deterministically:
```markdown
- Review ADO report from Tanvi (Task ID: AI-20260421-082145)
```

To add items for the waiting-on-others direction:
```sh
$ATLAS commit add --title "What they owe" --direction theirs --person "Person Name" --source "meeting/2026-04-24" --due "ASAP" --channel email --category work
```

The `--category` flag on `commit add` maps to Things 3 areas automatically based on the categories defined in `data/config.yaml`.

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
3. **`blocked`**: Apply to tasks where the user is waiting on someone else. Check: `$ATLAS commit list --direction theirs --status active`.

Use `~/.local/bin/things3/update.sh <id> --tags "tag1,tag2"` for tag updates. To find task IDs: `~/.local/bin/things3/search.sh "keyword"`.

Remove stale tags from completed or resolved items. Tags should reflect the current state, not yesterday's.

### Report
Present: "Added X tasks, completed Y tasks, updated tags on Z tasks" with the list.

## Step 4b: Pod assignments MCP fallback

Check if the pod assignments script left a marker requesting MCP fallback:

```sh
cat ~/.local/share/pod-assignments/needs-mcp-refresh 2>/dev/null
```

**If the marker file exists**, the ADO PAT is expired or missing and the launchd script couldn't refresh pod data. Use ADO MCP tools to do it instead:

1. **Query work items** via `mcp_microsoft_azu_wit_query_by_wiql`:
   - Organization: `ceapex`
   - Project: `Engineering`
   - WIQL: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'Engineering' AND [System.WorkItemType] IN ('Objective', 'Initiative', 'Epic') AND NOT [System.State] IN ('Removed', 'Closed') ORDER BY [Microsoft.VSTS.Scheduling.TargetDate]`

2. **Batch-fetch work item details** via `mcp_microsoft_azu_wit_get_work_items_batch_by_ids`:
   - Use the IDs returned from step 1
   - Fields: `System.Id, System.WorkItemType, System.Title, System.State, Microsoft.VSTS.Scheduling.StartDate, Custom.DevReadyDate, Microsoft.VSTS.Scheduling.TargetDate, Custom.RequiredDate, System.AssignedTo, Custom.DefinitionPod, Custom.Pod, Custom.EngineeringSWAGTotal, Custom.Statussummary, System.Parent`
   - Batch in groups of 200 if needed

3. **Save raw data and run generate.py**:
   ```sh
   REPORTS_DIR="$HOME/projects/work/ecosystems-product/05_teams/reports/pods"
   VENV_DIR="/tmp/xlsx-env"
   # Save raw_data.json from MCP response (write the JSON array of work items)
   # Save initiatives.json (filter to Initiative type items)
   # Rotate prior outputs
   [[ -f "$REPORTS_DIR/pod-assignments.xlsx" ]] && mv "$REPORTS_DIR/pod-assignments.xlsx" "$REPORTS_DIR/pod-assignments-previous.xlsx"
   [[ -f "$REPORTS_DIR/pod-insights.md" ]] && mv "$REPORTS_DIR/pod-insights.md" "$REPORTS_DIR/pod-insights-previous.md"
   # Ensure venv exists
   [[ ! -d "$VENV_DIR" ]] && python3 -m venv "$VENV_DIR" && "$VENV_DIR/bin/pip" install openpyxl -q
   # Run generate.py
   cd "$HOME/projects/work/ecosystems-product" && "$VENV_DIR/bin/python" "$REPORTS_DIR/generate.py"
   ```

4. **Remove the marker** after successful refresh:
   ```sh
   rm -f ~/.local/share/pod-assignments/needs-mcp-refresh
   ```

5. **Note in briefing**: Add "✅ Pod assignments refreshed via MCP (PAT expired)" in the Phase B report.

**If no marker file exists**, skip this step entirely. The launchd script handled it.

## Step 5: Update files and surface conflicts

**Update `/memories/priorities.md`:**
- Replace "Tomorrow's Meetings" with today's actual meeting list
- Add any new action items surfaced from overnight activity
- Remove items that were completed yesterday
- Only change what's clearly warranted

**Action items and waiting-on-others are updated automatically** by the `$ATLAS commit add/complete/nudge` commands in Step 4. Every mutation re-renders `assistant/data/context/action-items.md` and `assistant/data/context/waiting-on-others.md`. Do NOT manually edit these files.

**Surface conflicts:**
- Flag any scheduling conflicts or overloaded days
- Note if a priority from yesterday hasn't moved in several days
- Suggest 1-2 things to tackle, defer, or delegate
- If a meeting today involves someone who owes you something, suggest raising it

Append the Phase B report (task sync + conflicts) to the end of the conversation.
