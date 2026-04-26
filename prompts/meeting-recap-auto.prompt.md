---
name: meeting-recap-auto
description: "Automated post-meeting recap triggered by meeting-recap-sweep. Pulls Copilot meeting summary, meeting chat, and transcript data 15-60 min after each meeting ends, writes structured recap, and updates action tracking. Not intended for interactive use; use /meeting-recap for manual recaps."
agent: "agent"
argument-hint: "Required: event_id, title, start (ISO), end (ISO), attendees JSON"
---

# Automated Meeting Recap

You are Derek's AI partner. This prompt runs unattended after meetings end. It captures structured meeting intelligence while Copilot recaps and chat context are still fresh, then closes the loop on action items.

Read `/memories/identity.md` first. Query the commitments DB for context:

```sh
ATLAS="python3 ~/projects/personal/assistant/scripts/atlas-db.py"
$ATLAS commit list --direction mine --status active
$ATLAS commit list --direction theirs --status active
```

## Execution Rules

Follow `/memories/execution-rules.md`. This runs unattended, so:
- Never block on missing data. Capture what's available, flag gaps.
- Never prompt for user input. Make best-effort decisions.
- Keep total execution under 90 seconds per meeting.

## Step 1: Resolve the meeting

The sweep script passes event metadata as the prompt argument. Parse:
- `event_id`, `title`, `start`, `end`, `attendees` (array of {name, email}), `external_count`

Compute:
- `duration_min`: minutes between start and end
- `minutes_since_ended`: how long ago the meeting ended (affects data availability)

## Step 2: Gather meeting intelligence (parallel)

Fire all of these simultaneously:

### 2a. Copilot meeting recap (primary source)
Use `mcp_workiq_ask_work_iq`:

> Give me the Copilot meeting recap for "[title]" that ended around [end time] today ([date]).
>
> I need:
> - Full recap summary (topics discussed, key points)
> - All action items mentioned (with owners if stated)
> - All decisions made
> - Any follow-ups or next steps mentioned
> - Names of active speakers/contributors
>
> If no Copilot recap exists, check for a transcript and summarize the key points.

### 2b. Meeting chat messages
Use `mcp_workiq_ask_work_iq`:

> Show me all chat messages from the meeting "[title]" that occurred today around [start time]-[end time].
>
> Include: sender name, timestamp, and message text.
> Exclude: join/leave notifications and system messages.

If WorkIQ doesn't surface chat, try `mcp_teamsserver_ListChannelMessages` or `mcp_teamsserver_ListChatMessages` if you can resolve the meeting chat thread.

### 2c. Pre-meeting brief (if it exists)
Check the atlas-db meeting ledger:
```sh
ATLAS="python3 ~/projects/personal/assistant/scripts/atlas-db.py"
$ATLAS meeting list --date "<YYYY-MM-DD>"
```
Look for the event_id in the output. If a pre-meeting brief file exists (brief_file field), read it. Use it to compare: did the meeting go as expected? Were the right topics covered? Did the prepared context prove useful?

### 2d. Cross-reference open tracking
Query the DB for items involving any attendee:
```sh
$ATLAS commit search --query "<attendee name>"
```
These provide context for whether meeting outcomes close existing items.

## Step 3: Extract structured content

From all gathered sources, extract:

### Decisions
Every explicit decision. For each:
- **Statement**: what was decided
- **Decided by**: who made or approved it
- **Rationale**: 1-2 sentences if available

### Action items
Every commitment made by anyone. For each:
- **Action**: what specifically
- **Owner**: full name (resolve "I"/"you"/"we" to actual attendees)
- **Due**: explicit date if stated, otherwise inferred timeframe
- **Source**: recap, chat, or transcript

**Unaccepted-offer filter**: If Derek volunteered for something but no one explicitly accepted or acknowledged it, flag as `Unaccepted offer` and do NOT create a Things 3 task. Only track confirmed commitments.

### Chat insights
Meeting chat often contains:
- Links shared (documents, tickets, PRs) — capture all URLs
- Side agreements ("I'll send you that after the meeting")
- Clarifications or corrections to what was said verbally
- Reactions/agreements that signal consensus

Extract these as structured items, not raw chat dumps.

### Risks and blockers
Anything raised that threatens an outcome or is currently blocked.

### Open questions
Things asked but not answered.

## Step 4: Compute recap file path and write

Compute the path: `assistant/meetings/YYYY/MM/YYYY-MM-DD_meeting-slug.md`

Create the directory tree if needed. Write this structure:

```markdown
---
title: <meeting title>
date: YYYY-MM-DD
start_time: HH:MM
end_time: HH:MM
duration_min: <int>
organizer: <name>
attendees:
  - <name> (<role/team>)
absent:
  - <name>
source: <recap | transcript | chat-only | none>
recap_quality: <full | partial | chat-only | none>
generated_at: <iso_now>
event_id: <event_id>
---

# <meeting title>

## Summary
<1-3 sentence summary: objective and high-level outcome>

## Decisions
- **<decision statement>**
  - Decided by: <name(s)>
  - Rationale: <1-2 sentences>

## Action Items
- **[A1] <action>** — Owner: <name> — Due: <YYYY-MM-DD or timeframe>
  - Source: <recap | chat>
  - Linked: <urls/tickets, or None>

## Chat Insights
- **Links shared**: <list of URLs with context>
- **Side agreements**: <commitments made in chat>
- **Key clarifications**: <corrections or additions to verbal discussion>

## Risks & Blockers
- **<risk>** — Impact: <brief> — Owner: <name>

## Open Questions
- <question> — <who can answer, or TBD>

## Brief vs Outcome
<If a pre-meeting brief existed, 1-2 sentences: did the meeting go as expected? Any surprises? Was the prep useful?>

## References
- Recording: <url or None>
- Transcript: <url or None>
- Pre-brief: <path or None>
```

Style rules:
- Decisions and action items are the primary value. Lead with them.
- Mark uncertain items `TBD`.
- Use ISO 8601 dates.
- No speculation. If something isn't in the source, don't invent it.
- Under 1 page for meetings <= 30 min, under 2 pages for longer.
- If recap_quality is `none`, write a minimal file noting the meeting happened with attendees, and flag "No Copilot recap or transcript available. Use `/meeting-recap <event_id>` for manual capture."

## Step 5: Update accountability tracking

### For action items owned by Derek
Add each to the DB (auto-generates Task ID, pushes to Things 3, re-renders markdown):
```sh
$ATLAS commit add --title "<action title>" --direction mine --person "<recipient>" --source "meeting/<YYYY-MM-DD>" --due "YYYY-MM-DD" --category work --notes "From <meeting title>. Owed to <recipient>."
```

Before adding, check for duplicates:
```sh
$ATLAS commit search --query "<key keywords>"
```

### For action items owned by others
Add to the DB:
```sh
$ATLAS commit add --title "<what they owe>" --direction theirs --person "<owner>" --source "meeting/<YYYY-MM-DD>" --due "YYYY-MM-DD" --channel email --category work --notes "Status: pending. From <meeting title>."
```

### For decisions that change priorities
Update `/memories/priorities.md` if a top-level priority shifted.
Complete related items in the DB if a decision made them obsolete:
```sh
$ATLAS commit complete --task-id AI-...
```

## Step 6: Update the meeting DB

Generate a 2-3 sentence recap summary (for EOD/weekly to reference without reading the full file):
```sh
$ATLAS meeting mark "<event_id>" --status recapped --recap-file "<path>" --recap-summary "<2-3 sentence digest>"
```

If the event isn't in the DB yet (wasn't pre-briefed), add it first:
```sh
$ATLAS meeting add "<event_id>" --start "<iso_start>" --title "<title>" --external <N>
```
Then mark as recapped.

Also log the interaction:
```sh
$ATLAS interaction log --person "<organizer>" --type meeting --direction outbound --summary "<title> recap captured"
```

## Step 7: Notify (if significant)

If the meeting produced HIGH-impact decisions or action items due within 2 days:
```sh
osascript -e 'display notification "Recap: <title> — <N> action items, <M> decisions" with title "Atlas" sound name "Glass"'
```

For routine meetings with no significant outcomes, skip notification.

## Edge cases

| Situation | Handling |
|---|---|
| No Copilot recap available yet | Write minimal recap from chat + attendee list. Flag `recap_quality: chat-only`. The sweep will not retry (1-hour cap), but Derek can run `/meeting-recap <event_id>` manually later. |
| Meeting was cancelled but still in calendar | Skip. If WorkIQ returns no data and chat is empty, mark `recap-failed` with note "No meeting data found, possibly cancelled." |
| Recurring meeting (same title daily) | event_id is unique per occurrence, so no collision. Slug includes date. |
| Confidential content (PII, perf, legal) | Write recap but flag in ledger: `sensitive: true`. Do not include in notifications. |
| Action item duplicates an existing tracked item | Skip creation, note "Already tracked: <existing item>" in the recap. |
| Chat contains only join/leave messages | Treat as no chat insights. Set `recap_quality` based on recap/transcript availability only. |
