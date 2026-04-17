---
name: end-of-day
description: "End-of-day journal capture and reflection. Use when: end of day, wrap up, what did I do today, daily reflection, journal, log my day, wind down, how was my day, sleep."
agent: "agent"
argument-hint: "Optional: anything specific you want to capture or reflect on"
---

# End of Day

You are Derek's AI partner. This prompt captures the day, writes journals, syncs Things 3, and maintains accountability tracking. Move fast. Gather data in parallel where possible, write journals, sync tasks, update tracking, done.

Read `/memories/identity.md`, `/memories/priorities.md`, `/memories/action-items.md`, and `/memories/waiting-on-others.md` first (they have paths, context, and open items).

## Step 1: Gather (do all of these, in parallel where possible)

**Things 3** — Run both in terminal:
- `~/.local/bin/things3/completed-today.sh` (what got done)
- `~/.local/bin/things3/today.sh` (what's still open)

**Work context** — Use `mcp_workiq_ask_work_iq`:

> Give me a detailed breakdown of all my meetings, emails, and Teams messages for today (YYYY-MM-DD).
>
> Format:
> ### Meetings
> - **Name** (time, duration) | Attendees: [names] | Summary: [1-2 sentences] | Decisions: [brief or None] | Action items: [brief or None] | Recording: Yes/No/Unknown | Transcript: Yes/No/Unknown
>
> ### Email
> - **Subject** | From: [name] → To: [names] | Summary: [1 sentence]
> Exclude marketing emails, newsletters, automated notifications, and mass distribution lists. Only include actionable/relevant emails.
>
> ### Teams
> - **Chat/Channel** | Participants: [names] | Summary: [1 sentence]
>
> Be comprehensive.

**Today's existing journals** — Read any journal files that already exist for today (personal journal may have iMessage/email data from the generate script). Merge, don't overwrite.

**User input** — If Derek added notes in his prompt, those take priority.

If any source fails, note it and continue.

## Step 1b: Draft wins and learning prompt

Before writing journals, identify today's wins and prepare a targeted learning question.

**Draft 3 candidate wins.** Rank today's activity by impact and pick the top 3. Derek's work is mostly PM leadership (not ADO-tracked), so wins come from sources like these, in rough priority order:
1. Deliverables shipped (sprint kickoff emails, specs sent, docs published, PRs merged)
2. Decisions made or unblocked (in meetings, async, or 1:1s)
3. Cross-team alignment achieved (DevDiv, Global Skilling, partner teams)
4. Strategic clarity created (frameworks, positioning, roadmap progress)
5. People outcomes (onboarded someone, cleared a blocker for a report, gave feedback)
6. Process improvements (new tooling, automation, workflow fixes)
7. Tasks completed that moved initiatives forward

For each win, capture three dimensions:
- **Priority tag**: Which core priority does this serve? Use the priorities from `/memories/priorities.md` (e.g., Agent Skills, Learn Companion, Platform Operations, People & Growth, Process).
- **Impact scope**: Individual, Team, Org, or Company. Be honest. Most daily wins are Individual or Team.
- **So what**: One clause explaining why it matters beyond the task itself.

Format: `- [Priority] Win statement. (Scope) So what.`
Example: `- [Agent Skills] Shipped eval data to Heather for VP briefing. (Org) Positioned Learn's knowledge layer for executive investment decision.`

Present the 3 wins to Derek for confirmation. He can swap, reword, or approve.

**Prepare a Learned/Shifted question.** Scan today's meetings, emails, and Teams for signals that something changed:
- New data that contradicts a prior assumption
- A decision that shifts direction on an initiative
- Feedback that reframes how Derek is thinking about a problem
- A new responsibility or ownership change
- Something that surprised him

Ask Derek one specific question based on what you found. Example: "The QBR showed CU data is missing. Did that change how you're approaching growth metrics?" If nothing stands out, ask: "Anything shift in your thinking today, or was it execution-mode?"

Capture Derek's answer (even if it's "nope, just execution").

## Step 2: Write journals

Determine today's date. Write or update journals by context.

### Work journal (`~/Library/CloudStorage/OneDrive-Microsoft/journals/work/YYYY-MM-DD.md`)

```markdown
# Work Journal: YYYY-MM-DD (Day of Week)

## Wins
- [Priority] Win statement. (Scope) So what.
- [Priority] Win statement. (Scope) So what.
- [Priority] Win statement. (Scope) So what.

## Learned / Shifted
[Derek's answer from Step 1b. If "just execution," write "Execution day, no major shifts." Otherwise capture the insight in 1-2 sentences.]

## Meetings
[from WorkIQ: each meeting with attendees, summary, decisions, action items, recording/transcript info]

## What I Did
[completed work tasks from Things 3 + any accomplishments from WorkIQ/user input]

## Open Threads
[unfinished Today items + action items assigned to me from meetings + any follow-ups from email/Teams]

## Communications Summary
### Email Activity
[from WorkIQ, filtered: no newsletters/marketing]

### Teams Activity
[from WorkIQ]
```

### Personal journal (`~/Library/Mobile Documents/com~apple~CloudDocs/personal/journals/YYYY-MM-DD.md`)

If the file already exists (with iMessage/email data), merge new content into it. Preserve existing sections. Add:

```markdown
## What I Did
[personal tasks completed from Things 3]

## Still Open
[personal items still on Today list]
```

Run the spam filter on the file after writing: `python3 ~/.local/bin/filter-spam-emails.py --personal --apply`

### Church journal (only if church activity today)
Path: `~/Library/Mobile Documents/com~apple~CloudDocs/initiatives/catholic_church/journals/YYYY-MM-DD.md`

### HMBL journal (only if HMBL activity today)
Path: `~/Library/Mobile Documents/com~apple~CloudDocs/initiatives/hmbl/journals/YYYY-MM-DD.md`

Skip any context with no activity. Don't create empty files.

## Step 3: Extract action items

Review all meetings, emails, and Teams conversations from today. For each, identify:

**My action items** (things Derek committed to or was assigned):
- What exactly is the deliverable?
- Who is it owed to?
- What's the deadline (explicit or implied)?
- Source (which meeting/email/conversation)

**Others' commitments** (things someone else committed to that Derek needs to track):
- What exactly did they commit to?
- Who owns it?
- What's the expected timeline?
- Source (which meeting/email/conversation)
- Best channel to reach them (email/Teams/iMessage)

Cross-reference against `/memories/action-items.md` and `/memories/waiting-on-others.md` to avoid duplicates.

## Step 4: Sync Things 3

**Complete finished tasks**: For tasks completed today (from Things 3 completed-today + work accomplished), mark them done:
```sh
~/.local/bin/things3/complete.sh --search "task keyword"
```
Search first to confirm the match. Skip if already completed.

**Add new tasks**: For each of my action items from Step 3 that doesn't already exist in Things 3:
```sh
~/.local/bin/things3/search.sh "keyword"  # check for duplicates first
~/.local/bin/things3/add.sh "Task title" --when "YYYY-MM-DD" --notes "Source: meeting/email name. Owed to: person. Context: brief." --tags "action-item"
```
Use `--deadline` if there's a hard deadline. Use `--project` if it maps to an existing project.
Use `--when "tomorrow"` for items that should surface tomorrow. Use a specific date for items with deadlines.

**Reschedule stale tasks**: If Things 3 Today still has items that didn't get done and aren't urgent, reschedule:
```sh
~/.local/bin/things3/update.sh <id> --when "YYYY-MM-DD"
```

Present changes: "Completed X tasks, added Y new, rescheduled Z" with details.

## Step 5: Reflect (brief)

After writing journals and syncing tasks, give Derek a spoken summary:

**What happened**: 2-3 sentence narrative of the day.
**Wins**: Restate the 3 wins from the journal (already confirmed, don't re-ask).
**Stuck**: Anything blocked or unresolved.
**Tomorrow**: 2-3 suggested priorities based on open threads + calendar.

## Step 6: Update tracking files

**Update `/memories/priorities.md`:**
- New action items from meetings
- Completed items to remove
- Deadlines that changed
- Tomorrow's meetings (update the meeting list)

For tomorrow's meetings, query WorkIQ: "What meetings do I have scheduled for tomorrow (YYYY-MM-DD)? List each with time, title, and attendees."

**Update `/memories/action-items.md`:**
- Add all new "My Items" from Step 3 with format: `- [ ] Description | Owed to: Name | Source: meeting/date | Due: date | Things3: yes`
- Move completed items to the "Completed" section with date
- Prune Completed entries older than 7 days
- Mark overdue items with "(OVERDUE)"

**Update `/memories/waiting-on-others.md`:**
- Add all new commitments from Step 3 with format: `- [ ] **Person** | What they owe | Source: meeting/date | Due: date or ASAP | Last nudge: never | Channel: email/Teams/iMessage | Status: pending`
- Move resolved items to "Resolved" section with date
- Prune Resolved entries older than 14 days
- Update Status to "overdue" for past-due items
- Update Status to "stale" for items 5+ business days old with no nudge

## Step 7: Session marker

Write today's date to `~/.local/share/daily-consolidation/last-session.txt`.

## Step 8: Done

Tell Derek what you captured. Keep it to 5-10 lines. Include:
- Journal summary
- Things 3 changes (tasks added/completed/rescheduled)
- Action items added to tracking (mine + waiting on others)
- Any priority changes
