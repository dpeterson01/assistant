---
name: meeting-recap
description: "Generate post-meeting minutes from a transcript, recording, or notes, with decisions, action items, and auto-updates to action-items.md and waiting-on-others.md. Use when: meeting recap, write minutes, summarize the meeting, what just happened, post-meeting notes, action items from the meeting, recap that meeting."
agent: "agent"
argument-hint: "Optional: meeting title, calendar event, or 'last' (defaults to most recent meeting today). Paste transcript or notes if available."
---

# Meeting Recap

You are the user's AI partner. This prompt produces post-meeting minutes from a transcript, recording, or raw notes, then automatically updates the user's accountability tracking. It is the backward-looking complement to `/meeting-brief`.

Follow the shared preamble in `.instructions.md` for setup, execution rules, and gotchas.

## Step 1: Identify the meeting and source material

Resolve the target meeting:

- If user supplied a title or event ID, use that.
- If user supplied a transcript/notes inline, use those as the source.
- If user said "last" or no argument, default to the most recent meeting the user attended today (per WorkIQ calendar).

For each candidate meeting, gather:

- **Metadata**: title, date, start/end (or duration), organizer, attendees with emails (use WorkIQ).
- **Source material**, in priority order:
  1. User-pasted transcript or notes
  2. Copilot meeting recap / intelligent recap (via WorkIQ: "Give me the Copilot recap and full transcript for [meeting] on [date].")
  3. Raw transcript (via WorkIQ)
  4. the user's own notes (search personal journals and work journals from `data/config.yaml → journals`, and any meeting notes folder)
  5. None — proceed with what's known and flag gaps as "Not captured"

If you cannot resolve a single meeting, list candidates and stop.

## Step 2: Extract the structured content

Read the source material critically. Extract these elements explicitly:

### Decisions
Every explicit decision made. For each:
- **Statement**: what was decided
- **Decided by**: who made or approved it
- **Rationale**: 1–2 sentences if available
- **Effective date** if applicable

### Action items
Every commitment made by anyone in the meeting. For each:
- **Action**: what specifically
- **Owner**: full name (resolve "I" / "you" / "we" to actual people from the attendee list)
- **Due**: explicit date if stated, otherwise inferred timeframe ("this week", "before next sync", "ASAP")
- **Acceptance criteria**: what completes this, if discernible
- **Linked artifacts**: tickets, docs, threads mentioned

Be precise about ownership. If an action was assigned to "the team" or no specific person, flag it as **Owner: TBD**. If the user volunteered for something but no one explicitly accepted it, flag it as **Unaccepted offer** and do not create a Things 3 task (per the unaccepted-offer filter in `/morning-briefing.prompt.md`).

### Risks and blockers
Anything raised that threatens an outcome or is currently blocked.

### Parking lot
Items raised but explicitly deferred without resolution.

### Open questions
Things asked but not answered, or that came up and need follow-up clarity.

## Step 3: Write the recap file

Write to `~/projects/personal/assistant/meetings/YYYY/MM/YYYY-MM-DD_meeting-slug.md` (create the directory tree if needed). Use this exact structure:

```markdown
---
title: <meeting title>
date: YYYY-MM-DD
start_time: HH:MM
duration_min: <int>
organizer: <name>
attendees:
  - <name> (<role/team>)
  - ...
absent:
  - <name>
recorder: agent
source: <transcript | recap | notes | user-notes | none>
generated_at: <iso_now>
---

# <meeting title>

## Summary
<1–3 sentence summary: objective and high-level outcome>

## Decisions
- **<decision statement>**
  - Decided by: <name(s)>
  - Rationale: <1–2 sentences>
  - Effective: <YYYY-MM-DD or N/A>

## Action Items
- **[A1] <action>** — Owner: <name> — Due: <YYYY-MM-DD or timeframe>
  - Acceptance: <what completes this>
  - Linked: <urls/tickets, or None>

## Risks & Blockers
- **<risk>** — Impact: <brief> — Mitigation owner: <name>

## Parking Lot
- **<item>** — Why parked: <reason> — Next step: <when/who>

## Open Questions
- <question> — <who can answer, or TBD>

## Notes
<brief factual notes by topic, only if there are points worth preserving beyond the structured sections above>

## References
- Recording: <url or None>
- Transcript: <url or None>
- Related: <urls or None>
```

Style rules:
- Decisions and action items are the primary value. Lead with them.
- Mark uncertain items `TBD` and note how to resolve.
- Use ISO 8601 dates.
- No speculation. If something isn't in the source, don't invent it.
- Keep total length under 1 page for meetings ≤30 min, under 2 pages for longer meetings.

## Step 4: Auto-update accountability tracking

This is the loop-closing step. Move every action item into the right tracking system.

### For action items owned by the user
Add each to the DB. The command auto-generates a Task ID, pushes to Things 3, and re-renders markdown:

```sh
$ATLAS commit add --title "<action title>" --direction mine --person "<recipient>" --source "Meeting (<meeting title>): YYYY-MM-DD" --due "YYYY-MM-DD" --category work --notes "From <meeting title>. Acceptance: <criteria>."
```

**`--source` format**: Always use `Channel (Sender/Context): Subject`. The source string is used as a tag in Things 3 and shown in the task notes.

Before adding, search for an existing item to avoid duplicates:
```sh
$ATLAS commit search --query "<key keywords>"
```

### For action items owned by others (commitments to the user)
Add each to the DB:
```sh
$ATLAS commit add --title "<what they owe>" --direction theirs --person "<owner>" --source "Meeting (<meeting title>): YYYY-MM-DD" --due "YYYY-MM-DD" --channel email --category work --notes "Status: pending. Committed in meeting."
```

### For decisions
If a decision changes the user's priorities or open commitments:
- Update `/memories/priorities.md` if a top-level priority shifted
- Complete related items in the DB if a decision made them obsolete:
  ```sh
  $ATLAS commit complete --task-id AI-...
  ```

### For risks
If a risk needs the user's monitoring, create a task tagged `risk-watch`:
```sh
$ATLAS commit add --title "Monitor: <risk>" --direction mine --person "self" --source "meeting/YYYY-MM-DD/<meeting-slug>" --due "YYYY-MM-DD" --category work --notes "Risk watch from <meeting>."
```

### Store the recap in the DB
After writing the recap file, record it:
```sh
$ATLAS meeting recap --event-id "<event-id or meeting-slug>" --summary "<1-line summary>" --recap-file "<path to recap file>"
```

### Log the interaction
```sh
$ATLAS interaction log --person "<organizer>" --type meeting --direction outbound --summary "<meeting title> recap captured"
```

## Step 5: Surface the loop closure to the user

Present a tight summary:

> **Recap saved**: `<path>`
>
> **Decisions** (N): one-line list
> **Action items added to your tracking** (N): each with owner and due
> **Items added to waiting-on-others** (N): each with person and due
> **Risks flagged** (N, if any)
> **Open questions** (N, if any)
>
> **Things 3 changes**: X new tasks added (auto-pushed via atlas-db), Y duplicates skipped.
>
> **Suggested next moves**:
> - If there are HIGH-stakes action items due in the next 2 days, suggest acting on them now
> - If a follow-up meeting was implied, suggest scheduling it
> - If a decision changes a priority, ask whether to update `/memories/priorities.md`

## Edge cases

**No transcript or notes available.** Ask the user for the highlights in 3 questions: (1) What was decided? (2) Who's doing what by when? (3) Anything blocked or risky? Build the recap from his answers.

**Meeting was a 1:1 with no formal decisions.** Skip the Decisions section, focus on action items and any commitments either side made.

**Meeting was a routine standup with nothing actionable.** Note in summary "Routine sync, no decisions or new action items," skip empty sections, save anyway for the audit trail.

**Confidential or sensitive content.** Write the recap to the file but flag in the response if any content seems sensitive (PII, compensation, performance, legal). Ask the user before any external distribution.

**Action item ownership ambiguous.** Mark **Owner: TBD** and ask the user to clarify in the response. Do not create a Things 3 task with TBD ownership.
