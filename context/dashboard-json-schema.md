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
- `addedAt`: ISO-8601 timestamp

## Deep Link Fields (carryOver AND inbox)

Include on items originating from email or Teams:
- `source`: `"email"` | `"teams"` | `"imessage"` | `"priorities"` | `"journal"`
- `channel`: `"outlook-work"` | `"outlook-personal"` | `"gmail"` | `"hmbl"` | `"teams"` | `null`
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
- `optional`: `true` if Derek is optional, omit otherwise
- `highStakes`: `true` if meeting qualifies (see criteria below)
- `signals`: Array of signal strings
- `raiseThis`: Array of suggested talking points
- `prep`: Prep description string, or `null`
- `conflict`: Conflict description string, or `null`

### High-Stakes Criteria

A meeting is high-stakes if any:
- ≥1 external attendee (different domain than microsoft.com)
- Title matches `1:1`, `sync`, `review`, `decision`, `interview`, `leadership`, `debrief`, `prep`, or `kickoff` AND duration ≥ 25 min
- Derek owes someone in the meeting an action item
- Someone in the meeting owes Derek something overdue

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
    { "person": "name", "item": "short summary", "detail": "context", "stale": true, "daysOpen": 5 }
  ],
  "waitingOnOthers": 12,
  "stale": 3
}
```

## Important Rules

- Every checkbox item in .md MUST have a matching entry in JSON. The `id` field links them.
- Already-done items: `"status": "done"`, no `syncPending` flag.
- `accountability.waitingOn` must only include items from `$ATLAS commit list --direction theirs --status active`. Never include completed items.
- Include every triaged inbox item regardless of priority. Dashboard collapses low-priority behind a toggle.
- JSON is source of truth for dashboard. .md is human-readable for Typora.
