---
name: end-of-day
description: "End-of-day journal capture and reflection. Use when: end of day, wrap up, what did I do today, daily reflection, journal, log my day, wind down, how was my day, sleep."
agent: "agent"
argument-hint: "Optional: anything specific you want to capture or reflect on"
---

# End of Day

You are Derek's AI partner. This prompt captures the day, writes journals, syncs Things 3, and maintains accountability tracking. Move fast. Gather data in parallel where possible, write journals, sync tasks, update tracking, done.

Follow the shared preamble in `.instructions.md` for setup, execution rules, and gotchas.

## Step 1: Gather (do all of these, in parallel where possible)

**Things 3** — Run both in terminal:
- `~/.local/bin/things3/completed-today.sh` (what got done)
- `~/.local/bin/things3/today.sh` (what's still open)

**Work context** — Meetings: recap-first approach. Check for existing recap files before querying WorkIQ:

1. **Read today's meeting recaps** (produced by the meeting-recap-sweep automation):
   ```sh
   $ATLAS meeting list --date "$(date +%Y-%m-%d)"
   ```
   For each entry with `recap_status=recapped`, read the `recap_file`. These contain structured decisions, action items, chat insights, and attendee context — richer than what WorkIQ will reconstruct. Use `recap_summary` from the meeting record for the journal's meeting section.

2. **Fall back to WorkIQ** only for meetings that don't have recaps (status is not `recapped`, or not in ledger at all). Use `mcp_workiq_ask_work_iq`:

> Give me a detailed breakdown of meetings, emails, and Teams messages for today (YYYY-MM-DD) that are NOT covered by these meetings: [list titles of already-recapped meetings].
>
> For unrecapped meetings, format as:
> ### Meetings
> - **Name** (time, duration) | Attendees: [names] | Summary: [1-2 sentences] | Decisions: [brief or None] | Action items: [brief or None] | Recording: Yes/No/Unknown | Transcript: Yes/No/Unknown
> - If a meeting had a recording or transcript, include the **Copilot meeting recap** or **intelligent recap summary** if available. Capture: key topics discussed, action items assigned (with owners), decisions made, and any follow-ups mentioned.
> - If no Copilot recap is available but a transcript exists, summarize the key points from the transcript.
>
> ### Email
> - **Subject** | From: [name] → To: [names] | Summary: [1 sentence]
> Exclude marketing emails, newsletters, automated notifications, and mass distribution lists. Only include actionable/relevant emails.
>
> ### Teams
> - **Chat/Channel** | Participants: [names] | Summary: [1 sentence]
>
> Be comprehensive. For meetings with transcripts/recordings, I specifically need the Copilot summary or recap content, not just a flag that they exist.

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

**Scan for Connects signals.** Beyond the top 3 wins, quickly scan today's activity for anything that maps to Connects dimensions. These don't need to be wins; they just need to be captured before the details fade. Check for:

- **Manager Excellence**: Did you coach, give feedback, unblock, or develop a direct report? Have a career conversation? Set direction or improve team clarity?
- **D&I**: Did you amplify a diverse perspective, ensure equitable participation in a meeting, advocate for accessibility, or contribute to an ERG?
- **AI Adoption**: Did you use Copilot, MCP tools, or agent workflows to get something done faster? Did you help a team member adopt AI tools?
- **One Microsoft**: Did you partner cross-org (DevDiv, Global Skilling, etc.) in a way that reduced silos or shared knowledge?

If any signals exist, note them briefly. Not every day will have them. Don't force it.

## Step 2: Write journals

Determine today's date. Write or update journals by context.

### Work journal (`~/Library/CloudStorage/OneDrive-Microsoft/journals/work/YYYY-MM-DD.md`)

**DATA BOUNDARY**: Never include iMessage content, personal email, or non-Microsoft data in the work journal. iMessage and personal communications belong exclusively in the personal journal. If an iMessage relates to work (e.g., a colleague texting about a deadline), capture only the work-relevant fact without attributing it to iMessage.

```markdown
# Work Journal: YYYY-MM-DD (Day of Week)

## Wins
- [Priority] Win statement. (Scope) So what.
- [Priority] Win statement. (Scope) So what.
- [Priority] Win statement. (Scope) So what.

## Learned / Shifted
[Derek's answer from Step 1b. If "just execution," write "Execution day, no major shifts." Otherwise capture the insight in 1-2 sentences.]

## Meetings
[List each meeting chronologically. For meetings with recap files, pull structured data directly from the recap — this is higher-fidelity than WorkIQ summaries.]

### <Meeting Title> (time, duration)
**Summary**: [from recap or WorkIQ]
**Decisions**: [from recap's ## Decisions section, or from WorkIQ]
**Follow-ups**:
- [Action items from recap's ## Action Items — include owner, due date, and acceptance criteria]
- [Open questions from recap's ## Open Questions — these often become tomorrow's tasks]
- [Parking lot items from recap's ## Parking Lot — note when they'll be revisited]
**Risks/Blockers**: [from recap's ## Risks & Blockers, or None]

[For meetings without recaps, use WorkIQ data with the same structure but note "(via WorkIQ)" after the title]

## What I Did
[completed work tasks from Things 3 + any accomplishments from WorkIQ/user input]

## Open Threads
[unfinished Today items + action items assigned to me from meetings + any follow-ups from email/Teams]

## Connects Signals
[Only include sections where something actually happened today. Omit empty sections.]
### Manager Excellence
[coaching, feedback, unblocking, career conversations, direction-setting — or omit if none]
### D&I
[diverse perspectives amplified, equitable participation, accessibility, ERG — or omit if none]
### AI Adoption
[Copilot usage, MCP tools, agent workflows, helping team adopt AI — or omit if none]
### One Microsoft
[cross-org collaboration, knowledge sharing, silo reduction — or omit if none]

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

Cross-reference against the DB using `$ATLAS commit search --query "keyword"` to avoid duplicates.

## Step 3b: Contacts enrichment

Scan today's meetings, emails, and Teams conversations for personal details about people Derek interacted with. Look for:

- **Birthdays** mentioned in conversation ("happy birthday", "my birthday is...", "turning X")
- **Family mentions** (spouse/partner names, kids, parents mentioned in small talk)
- **Life events** (anniversaries, new roles, relocations)

For each discovery:
1. Look up the contact: `~/.local/bin/contacts/show.sh "Name"`
2. If the info is new (not already in the contact), enrich it:
   - Birthday: `~/.local/bin/contacts/enrich.sh "Name" --birthday "YYYY-MM-DD"`
   - Spouse: `~/.local/bin/contacts/enrich.sh "Name" --spouse "Spouse Name"`
   - Other relations: `~/.local/bin/contacts/enrich.sh "Name" --child "Name"` (or --parent, --sibling, --friend)
3. Use `--dry-run` first if unsure, then confirm with Derek before writing

Present any enrichments made: "Updated X contacts with new info" with details.

Skip this step if no personal details were surfaced today. Don't force it.

## Step 3c: Update work contacts directory

Read `~/Library/CloudStorage/OneDrive-Microsoft/01_people/contacts/index.json` once to get the name-to-file mapping.

For each person Derek had a meaningful interaction with today (meetings, email threads, 1:1s), look them up in the index (match on name, aliases, or email).

**If the file exists**: Update it with any new context learned today (decisions made, topics discussed, personal details surfaced, role changes).

**If no file exists** and this is someone Derek works with regularly (not a one-off interaction): Create a new file following the template in the directory's README.md. Include name, role, org, relationship type, and any context from today's interactions. Then add the new entry to `index.json` (include aliases if the person's filename doesn't exactly match their display name).

**Backfill emails**: As you process today's emails and meeting invites, harvest Microsoft aliases (e.g., `curtlee@microsoft.com` from a calendar attendee or email header). For any contact in `index.json` that is missing an `"email"` field, add it. Also add the email to the contact's markdown file frontmatter. This builds up the index over time so future lookups can match on email.

After updating files, run the sync script to push any enrichable data (birthdays, family) to iCloud contacts:
```sh
~/.local/bin/contacts/sync-to-icloud.sh --dry-run
```
Present the dry-run results. If there are updates to make, ask Derek to confirm, then run without `--dry-run`.

## Step 4: Sync Things 3

**Complete finished tasks**: For any items identified as done today, complete via atlas-db:
```sh
$ATLAS commit complete --task-id "AI-..."
```
This updates the DB, pushes completion to Things 3, and re-renders the markdown views.

**Add new tasks**: For each of my action items from Step 3 that doesn't already exist:
```sh
$ATLAS commit add --title "Task title" --direction mine --person "Person" --source "meeting/email name" --due "YYYY-MM-DD" --category work --notes "Context: brief."
```
This auto-generates a Task ID, pushes to Things 3, and re-renders markdown. Use `--due "ASAP"` for items with no hard deadline.

For items others committed to (waiting-on-others):
```sh
$ATLAS commit add --title "What they owe" --direction theirs --person "Person" --source "meeting/YYYY-MM-DD" --due "ASAP" --channel email --category work --notes "Status: pending"
```

**Reschedule stale tasks**: If Things 3 Today still has items that didn't get done and aren't urgent, reschedule:
```sh
~/.local/bin/things3/update.sh <id> --when "YYYY-MM-DD"
```

Present changes: "Completed X tasks, added Y new, rescheduled Z" with details.

## Step 5: Reflect (brief)

After writing journals and syncing tasks, give Derek a spoken summary:

**What happened**: 2-3 sentence narrative of the day.
**Wins**: Restate the 3 wins from the journal (already confirmed, don't re-ask).
**Meeting follow-ups**: Summarize all follow-ups extracted from today's meeting recaps. Group by owner: "Derek owes X items" and "Waiting on Y items from others." Call out any open questions that need answers before tomorrow's meetings.
**Stuck**: Anything blocked or unresolved.
**Tomorrow**: 2-3 suggested priorities based on open threads + calendar + unresolved follow-ups from today's meetings.

## Step 6: Update tracking files

**Action items and waiting-on-others are updated automatically** by the `$ATLAS commit add/complete/nudge` commands in Steps 3-4. Every mutation re-renders `assistant/data/context/action-items.md` and `assistant/data/context/waiting-on-others.md`. Do NOT manually edit these files.

**Update `/memories/priorities.md`:**
- New action items from meetings
- Completed items to remove
- Deadlines that changed
- Tomorrow's meetings (update the meeting list)

For tomorrow's meetings, query WorkIQ: "What meetings do I have scheduled for tomorrow (YYYY-MM-DD)? List each with time, title, and attendees."

## Step 7: Session marker

Write today's date to `~/.local/share/daily-consolidation/last-session.txt`.

## Step 8: Done

Tell Derek what you captured. Keep it to 5-10 lines. Include:
- Journal summary
- Things 3 changes (tasks added/completed/rescheduled)
- Action items added to tracking (mine + waiting on others)
- Any priority changes
