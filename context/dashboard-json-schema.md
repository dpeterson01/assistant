# Dashboard JSON Schema

Schema for `YYYY-MM-DD_daily_brief.json`. Referenced by `/morning-briefing` Step 3b.

## Top-Level Structure

```json
{
  "date": "YYYY-MM-DD",
  "generatedAt": "ISO-8601 timestamp",
  "lastUpdated": "ISO-8601 timestamp (same as generatedAt initially)",
  "updateCount": 0,
  "checkpointId": "AI-YYYYMMDD-HHMMSS",
  "weeklyObjectives": { ... },
  "dailyMITs": { ... },
  "dayFit": { ... },
  "carryOver": [<items>],
  "inbox": [<items, all priority levels>],
  "inboxLowCount": <number of low-priority items>,
  "meetings": [<meetings>],
  "tasks": [<Things 3 today items>],
  "accountability": { ... },
  "upcoming": [<next 2-3 days items>]
}
```

## dayFit

```json
{
  "score": 75,
  "level": "green|yellow|red",
  "summary": "one-line summary",
  "failures": ["criterion that failed", ...],
  "passes": ["criterion that passed", ...],
  "recoveryMoves": ["suggestion", ...]
}
```

## Per-Item Fields (carryOver, inbox, tasks)

Required on all items:
- `id`: Stable identifier. Use Things 3 Task ID (`AI-YYYYMMDD-HHMMSS`) if created, otherwise kebab-case slug
- `text`: Brief item title (matches briefing checkbox text minus Task ID)
- `detail`: 1-2 sentence context (optional, can be empty string)
- `priority`: `"high"` | `"medium"` | `"low"`
- `status`: `"open"` (always for newly generated items)
- `category`: `"work"` | `"personal"` | additional context categories you define in `data/config.yaml` — required on every item. Determines which filter pill the item appears under.
- `addedAt`: ISO-8601 timestamp

## Deep Link Fields (carryOver AND inbox)

Include on items originating from email or Teams:
- `source`: `"email"` | `"teams"` | `"imessage"` | `"priorities"` | `"journal"`
- `channel`: `"outlook-work"` | `"outlook-personal"` | `"gmail"` | `"teams"` | channel ids from `data/config.yaml` | `null`
- `sender`: Display name
- `emailId`: Exchange/Gmail message ID from MCP response. `null` only if truly unavailable.
- `threadId`: Teams chat/channel thread ID. `null` for non-Teams.
- `teamsDeepLink`: Full Teams deep link URL or `null`
- `chatName`: Teams chat/channel name or `null`

When carrying items forward from previous briefing's inbox to today's carryOver, **preserve all deep link fields**.

## Inbox-Only Fields

- `receivedAt`: ISO-8601 timestamp of original message/email receipt
- `draftConfidence`: Score from Step 2 inline draft scoring (0.0-1.0), or `null`
- `draftReason`: One-line explanation of confidence, or `null`

## Meeting Fields

- `id`: Kebab-case slug from title
- `title`, `time`, `endTime`, `duration` (minutes)
- `attendees`: Array of display names
- `attended`: `false` (set to `true` by EOD or sync)
- `optional`: `true` if the user is optional, omit otherwise
- `highStakes`: `true` if meeting qualifies (see criteria below)
- `whyItMatters`: 1-2 sentence synthesis of why this meeting matters today (from signals + open items + agenda). `null` for routine meetings.
- `signals`: Array of signal objects (see Signal Format below)
- `raiseThis`: Array of raise objects (see Raise Format below)
- `peopleContext`: Array of people-context objects (see People Context Format below). Surface insights from contact files that are relevant *today*.
- `prep`: Prep description string, or `null`
- `conflict`: Conflict description string, or `null`

### People Context Format

For each attendee with a contact file, surface any context that matters *for this specific meeting today*. Skip attendees with no notable context. Each entry:

```json
{
  "name": "Person name",
  "items": [
    { "type": "birthday", "detail": "Birthday is today (Apr 27)" },
    { "type": "style", "detail": "Prefers data-driven arguments; sensitive to PM overriding engineering decisions" },
    { "type": "history", "detail": "Last 1:1 Apr 13: discussed ADO queries and agent skills transition. No sync since." },
    { "type": "watch", "detail": "Tends to volunteer for things without clear acceptance criteria. Pin down deliverables." }
  ]
}
```

Types:
- `birthday`: Birthday today, tomorrow, or this week. Always include if applicable.
- `style`: Working style notes relevant to this meeting's topic. Skip generic traits.
- `history`: Last interaction summary + time gap. Useful for 1:1s and catch-ups.
- `relationship`: Relationship context (direct report, skip-level, cross-team, external).
- `watch`: Anything flagged as "watch out for" or a pattern to be aware of.
- `personal`: Personal details worth acknowledging (e.g., just returned from leave, recently promoted).

Only include items that are actionable for *this meeting*. Don't dump the whole contact file.

### Signal Format

Each signal must be a structured object, not a bare string:

```json
{
  "source": "email|teams|prior-briefing|action-items|waiting-on|journal|contact",
  "who": "Person name (or null if systemic)",
  "summary": "One specific sentence with enough context to act on. Include what happened, what it means, and why it matters for this meeting."
}
```

Bad: `"Companion DSB/RAI thread active"`
Good: `{ "source": "teams", "who": "Alice Kim", "summary": "Alice posted in the product channel asking whether spec review ownership sits with PM or engineering after the compliance assessment was resubmitted. Needs a decision before the spec ships." }`

Bad: `"You owe: blocked epic follow-up"`
Good: `{ "source": "action-items", "who": "Bob Chen", "summary": "the user committed to follow up on Bob's epic (1134xxx) that's blocked pending engineering investigation. Last discussed Apr 21, no update since. Bob will expect a status update." }`

### Raise Format

Each raise item must be a structured object with enough detail to speak from directly:

```json
{
  "topic": "Short label (for display)",
  "detail": "What specifically to say or ask, with enough context that the user can raise it without looking anything up. Reference specific artifacts, dates, or commitments."
}
```

Bad: `"DSB/RAI status and ownership"`
Good: `{ "topic": "spec review ownership", "detail": "Ask Alice who owns the spec review now that assessment was resubmitted on Apr 23. If engineering owns it, confirm Alice will track in the spec. If PM owns it, the user needs to add it to their queue." }`

Bad: `"Any blockers"`
Good: `{ "topic": "Experimentation blockers", "detail": "Ask Samir if the A/B test config for Learn search ranking landed in the latest deploy. Last week he said it was blocked on feature flag approval from the platform team." }`

### High-Stakes Criteria

A meeting is high-stakes if any:
- ≥1 external attendee (different domain than the user's employer domain)
- Title matches `1:1`, `sync`, `review`, `decision`, `interview`, `leadership`, `debrief`, `prep`, or `kickoff` AND duration ≥ 25 min
- the user owes someone in the meeting an action item
- Someone in the meeting owes the user something overdue

## Tasks Section

Populate from Things 3 Today items:
- `id`: `AI-` Task ID from `$ATLAS commit add`, or Things 3 task ID prefixed with `t-`
- `text`: Task title
- `project`: Things 3 project name
- `status`: `"open"`
- `addedAt`: ISO-8601 timestamp

## Accountability

```json
{
  "overdue": ["string items"],
  "approaching": ["string items"],
  "waitingOn": [
    { "person": "name", "item": "short summary", "detail": "context", "channel": "email|Teams|gmail|outlook-work", "stale": true, "daysOpen": 5 }
  ],
  "waitingOnOthers": 12,
  "stale": 3
}
```

## Important Rules

- Every checkbox item in .md MUST have a matching entry in JSON. The `id` field links them.
- Already-done items: `"status": "done"`, no `syncPending` flag.
- `accountability.waitingOn` must only include items from `$ATLAS commit list --direction theirs --status active`. Never include completed items. Preserve the `channel` field from atlas-db output (e.g. "email", "Teams") so the dashboard can deep-link to the correct platform.
- Include every triaged inbox item regardless of priority. Dashboard collapses low-priority behind a toggle.
- JSON is source of truth for dashboard. .md is human-readable for Typora.

## Weekly Objectives

Top-level field `weeklyObjectives`. Populated from `$ATLAS objective list`:

```json
{
  "weeklyObjectives": {
    "week": "2026W20",
    "score": "1/3",
    "items": [
      {
        "id": "OBJ-2026W20-1",
        "rank": 1,
        "title": "Ship agent skills eval doc to leadership",
        "context": "work",
        "status": "active",
        "linkedTasks": 3
      },
      {
        "id": "OBJ-2026W20-2",
        "rank": 2,
        "title": "Complete deck for team offsite",
        "context": "work",
        "status": "completed",
        "linkedTasks": 2
      },
      {
        "id": "OBJ-2026W20-3",
        "rank": 3,
        "title": "Schedule annual vet appointments",
        "context": "personal",
        "status": "active",
        "linkedTasks": 1
      }
    ]
  }
}
```

Fields:
- `week`: ISO week string (from `$ATLAS objective list`)
- `score`: "X/3" format (from `$ATLAS objective score`)
- `items[].id`: Objective ID
- `items[].rank`: 1-3
- `items[].title`: Objective outcome statement
- `items[].context`: category id (e.g. work/personal, or additional contexts from config)
- `items[].status`: proposed/active/completed/dropped/carried
- `items[].linkedTasks`: Count of tasks linked to this objective

## Daily MITs

Top-level field `dailyMITs`. Populated from `$ATLAS mit list`:

```json
{
  "dailyMITs": {
    "date": "2026-05-05",
    "score": "2/3",
    "items": [
      {
        "id": "MIT-2026-05-05-1",
        "rank": 1,
        "title": "Draft eval doc executive summary",
        "status": "completed",
        "objectiveId": "OBJ-2026W20-1"
      },
      {
        "id": "MIT-2026-05-05-2",
        "rank": 2,
        "title": "Reply to blocked epic thread",
        "status": "completed",
        "objectiveId": null
      },
      {
        "id": "MIT-2026-05-05-3",
        "rank": 3,
        "title": "Review team offsite agenda",
        "status": "active",
        "objectiveId": "OBJ-2026W20-2"
      }
    ]
  }
}
```

Fields:
- `date`: Today's date
- `score`: "X/3" format (from `$ATLAS mit score`)
- `items[].id`: MIT ID
- `items[].rank`: 1-3
- `items[].title`: MIT text
- `items[].status`: active/completed/deferred
- `items[].objectiveId`: Linked objective ID or null
