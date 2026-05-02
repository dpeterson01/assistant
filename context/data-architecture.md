# Data Architecture

The source of truth for commitments (action items + waiting-on-others), meetings, and interactions is **assistant.db** (SQLite). All reads and writes go through `atlas-db.py`:

```sh
ATLAS="python3 ~/projects/personal/assistant/scripts/atlas-db.py"
```

**At the start of every agent run**, pull Things 3 completions into the DB:
```sh
$ATLAS sync-things3
```

## Query Reference

All queries return JSON.

- `$ATLAS commit list --direction mine --status active` (my open action items)
- `$ATLAS commit list --direction theirs --status active` (what others owe the user)
- `$ATLAS commit overdue` (all overdue items, both directions)
- `$ATLAS commit search --query "your manager"` (cross-cutting search)
- `$ATLAS meeting list --date YYYY-MM-DD` (meetings on a given date)
- `$ATLAS meeting pending` (meetings needing briefs)
- `$ATLAS meeting show --event-id ID` (single meeting detail)
- `$ATLAS interaction list --person "..." --days 30` (recent interactions with a person)

## Mutation Reference

All mutations auto-render `assistant/context/action-items.md` and `assistant/context/waiting-on-others.md`.

- `$ATLAS commit add --title "..." --direction mine --person "..." --source "..." --due "..." --category work` (auto-generates Task ID, auto-pushes to Things 3)
- `$ATLAS commit complete --task-id AI-...` (marks done in DB + Things 3, re-renders markdown)
- `$ATLAS commit cancel --task-id AI-...` (cancels a commitment)
- `$ATLAS commit nudge --task-id AI-... --channel email` (records nudge timestamp)
- `$ATLAS meeting add --event-id ID --title "..." --start ISO` (claim a meeting for briefing)
- `$ATLAS meeting mark --event-id ID --status sent --file PATH` (update brief status)
- `$ATLAS meeting recap --event-id ID --summary "..." --recap-file PATH` (store recap)
- `$ATLAS interaction log --person "..." --type meeting --direction outbound --summary "..."` (log interaction)

## Important

**Do NOT manually edit** `assistant/context/action-items.md` or `assistant/context/waiting-on-others.md`. They are generated views.
