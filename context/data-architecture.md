# Data Architecture

The source of truth for commitments (action items + waiting-on-others), meetings, interactions, objectives, and daily MITs is **assistant.db** (SQLite). All reads and writes go through `atlas-db.py`:

```sh
ATLAS="python3 ~/projects/personal/assistant/scripts/atlas-db.py"
```

**At the start of every agent run**, pull Things 3 completions into the DB:
```sh
$ATLAS sync-things3
```

## Query Reference

All queries return JSON.

### Commitments & Meetings

- `$ATLAS commit list --direction mine --status active` (my open action items)
- `$ATLAS commit list --direction theirs --status active` (what others owe the user)
- `$ATLAS commit overdue` (all overdue items, both directions)
- `$ATLAS commit search --query "your manager"` (cross-cutting search)
- `$ATLAS meeting list --date YYYY-MM-DD` (meetings on a given date)
- `$ATLAS meeting pending` (meetings needing briefs)
- `$ATLAS meeting show --event-id ID` (single meeting detail)
- `$ATLAS interaction list --person "..." --days 30` (recent interactions with a person)

### Objectives & MITs

- `$ATLAS objective list` (active week's objectives, JSON)
- `$ATLAS objective list --week 2026-W19` (specific week)
- `$ATLAS mit list` (today's MITs, JSON)
- `$ATLAS mit list --date 2026-05-04` (specific date)

## Mutation Reference

All mutations auto-render `assistant/context/action-items.md`, `assistant/context/waiting-on-others.md`, and `assistant/context/objectives.md`.

### Commitments & Meetings

- `$ATLAS commit add --title "..." --direction mine --person "..." --source "..." --due "..." --category work` (auto-generates Task ID, auto-pushes to Things 3)
- `$ATLAS commit complete --task-id AI-...` (marks done in DB + Things 3, re-renders markdown)
- `$ATLAS commit cancel --task-id AI-...` (cancels a commitment)
- `$ATLAS commit nudge --task-id AI-... --channel email` (records nudge timestamp)
- `$ATLAS meeting add --event-id ID --title "..." --start ISO` (claim a meeting for briefing)
- `$ATLAS meeting mark --event-id ID --status sent --file PATH` (update brief status)
- `$ATLAS meeting recap --event-id ID --summary "..." --recap-file PATH` (store recap)
- `$ATLAS interaction log --person "..." --type meeting --direction outbound --summary "..."` (log interaction)

### Objectives (weekly top-3)

- `$ATLAS objective set --rank 1 --title "..." --context work --week 2026-W19` (create/update; status defaults to proposed)
- `$ATLAS objective set --rank 1 --title "..." --status active` (promote proposed to active)
- `$ATLAS objective score --rank 1 --status completed --score 10` (score 0-10, mark final status)
- `$ATLAS objective carry --rank 2 --to-week 2026-W20` (carry incomplete objective forward)
- `$ATLAS objective link --rank 1 --task-id AI-...` (link a commitment to an objective)
- `$ATLAS objective complete --rank 1` (shorthand: mark completed with score 10)

### Daily MITs (daily top-3)

- `$ATLAS mit set --rank 1 --title "..." --objective-id OBJ-2026W19-1` (set today's MIT, optional objective link)
- `$ATLAS mit complete --rank 1` (mark MIT done)
- `$ATLAS mit score --rank 1 --status deferred` (override status: active/completed/deferred)

## ID Formats

- Objectives: `OBJ-{year}W{week:02d}-{rank}` (e.g., `OBJ-2026W19-1`)
- MITs: `MIT-{date}-{rank}` (e.g., `MIT-2026-05-04-1`)
- Commitments: `AI-{YYMMDD}-{4hex}` (e.g., `AI-260501-a3f2`)

## Tables

| Table | Purpose |
|-------|---------|
| `commitments` | Action items (mine + waiting-on-others) |
| `meetings` | Tracked meetings with briefs/recaps |
| `interactions` | People interaction log |
| `objectives` | Weekly top-3 objectives with scoring |
| `objective_tasks` | Links objectives to commitment task_ids |
| `daily_mits` | Daily top-3 Most Important Tasks |

## Important

**Do NOT manually edit** `assistant/context/action-items.md`, `assistant/context/waiting-on-others.md`, or `assistant/context/objectives.md`. They are generated views.
