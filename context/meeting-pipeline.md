# Meeting Pipeline

End-to-end flow for automated meeting briefs and recaps. All components are active.

## Components

| Component | Status | Schedule |
|---|---|---|
| `meeting-sweep.sh` | ✅ Loaded | Every 15 min, M-F 7AM-6PM |
| `meeting-recap-sweep.sh` | ✅ Loaded | Every 15 min, M-F 7AM-7PM |
| `meeting-brief.prompt.md` | ✅ Exists | Invoked by sweep |
| `meeting-recap.prompt.md` | ✅ Exists | Invoked by recap sweep |
| `meeting-brief-ledger.py` | ✅ Exists | Dedup layer |
| `meetings` table in DB | ✅ Created | Tracks brief/recap status per event |

## Flow

1. **meeting-sweep.sh** runs every 15 min during work hours
2. Fetches upcoming calendar events (next 60 min) via Copilot CLI + WorkIQ
3. Filters through `$ATLAS meeting pending` to skip already-briefed events
4. For each pending high-stakes meeting, invokes the `meeting-brief` agent
5. Agent writes a per-meeting brief file and marks it in the DB

6. **meeting-recap-sweep.sh** runs every 15 min
7. Fetches recently ended meetings via `$ATLAS meeting recap-pending`
8. Invokes `meeting-recap` agent for each, producing structured recap files

## Verification

Check logs:
```sh
cat ~/projects/personal/assistant/automation/logs/meeting-sweep-$(date +%Y-%m-%d).log
cat ~/projects/personal/assistant/automation/logs/meeting-recap-sweep-$(date +%Y-%m-%d).log
```

Check DB state:
```sh
$ATLAS meeting list --date $(date +%Y-%m-%d)
```

## Troubleshooting

- **No events returned**: Calendar MCP may need re-auth. Check `copilot` CLI availability.
- **"Skipping: weekend/outside work hours"**: Expected. Sweeps only run during work hours.
- **Brief already exists**: `$ATLAS meeting pending` filters out briefed events. Check with `$ATLAS meeting show --event-id <id>`.
