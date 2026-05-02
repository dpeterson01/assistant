# State Locations

Complete inventory of where Atlas stores and reads persistent state. Use this to debug data flow, avoid duplicating state, and understand which component owns what.

Updated: 2026-04-24

## Source of Truth: SQLite (`assistant/data/state/assistant.db`)

| Table | Purpose | Accessed By |
|---|---|---|
| `commitments` | Action items (mine + theirs). Primary task tracker. | `atlas-db.py`, `server.js`, all prompts via `$ATLAS` CLI |
| `meetings` | Per-event state: brief status, recap status, file paths, action items | `atlas-db.py`, `meeting-brief-ledger.py`, meeting sweeps |
| `interactions` | Relationship log: person, type, direction, summary, timestamp | `atlas-db.py`, `nudge.prompt.md`, `relationship-drift.py` |
| `meta` | Schema version tracking | `atlas-db.py` |

WAL mode: `assistant.db-shm`, `assistant.db-wal` alongside.

## Generated Views (auto-rendered by `atlas-db.py render`)

These are **read-only derivatives** of the DB. Never edit manually.

| File | Source | Consumers |
|---|---|---|
| `context/action-items.md` | `commitments WHERE direction='mine'` | All prompts, `briefing-sync.sh` |
| `context/waiting-on-others.md` | `commitments WHERE direction='theirs'` | `nudge.prompt.md`, `end-of-day.prompt.md` |
| `/memories/action-items.md` | Same (user memory copy) | Loaded into agent context automatically |

## JSON State Files

| File | Purpose | R/W | Consumers |
|---|---|---|---|
| `briefings/YYYY-MM-DD_daily_brief.json` | Dashboard data with checkbox state, `syncPending` flags | R/W | `server.js`, `briefing-sync.sh`, morning/EOD prompts |
| `automation/.checkpoints/YYYY-MM-DD.json` | Checkbox state snapshots for diff detection | R/W | `checkpoint-helper.py`, `check-briefing.prompt.md` |
| `automation/manifest.json` | Scheduled task config: schedules, enabled state, last_run | R/W | All automation scripts |
| `state/meeting-briefs.json` | Legacy meeting brief ledger (mostly superseded by `meetings` table) | R/W | `meeting-brief-ledger.py` |

## Markdown Briefings and Journals

### Briefings (`assistant/data/briefings/`)
| Pattern | Purpose | Writer | Readers |
|---|---|---|---|
| `YYYY-MM-DD_daily_brief.md` | Human-readable briefing with checkboxes | `morning-briefing.prompt.md` | the user (Typora), `check-briefing.prompt.md`, `end-of-day.prompt.md` |

### Meeting Recaps (`assistant/meetings/`)
| Pattern | Purpose | Writer | Readers |
|---|---|---|---|
| `YYYY/MM/YYYY-MM-DD_meeting-slug.md` | Structured recap: decisions, action items, attendees | `meeting-recap.prompt.md` | `end-of-day.prompt.md`, `weekly-review.prompt.md` |

### Work Journals (OneDrive)
| Path | Writer | Readers |
|---|---|---|
| `~/Library/CloudStorage/OneDrive-Microsoft/journals/work/YYYY-MM-DD.md` | `end-of-day.prompt.md` | `morning-briefing.prompt.md`, `weekly-review.prompt.md` |
| `~/Library/CloudStorage/OneDrive-Microsoft/journals/weekly/` | `weekly-review.prompt.md` | `morning-briefing.prompt.md` |

### Personal Journals (iCloud)
| Path | Writer | Readers |
|---|---|---|
| `~/Library/Mobile Documents/com~apple~CloudDocs/personal/journals/YYYY-MM-DD.md` | `end-of-day.prompt.md` | `morning-briefing.prompt.md`, `weekly-review.prompt.md` |
| `~/Library/Mobile Documents/com~apple~CloudDocs/personal/weekly/` | `weekly-review.prompt.md` | `morning-briefing.prompt.md` |

### Church Journals (iCloud)
| Path | Writer | Readers |
|---|---|---|
| `~/Library/Mobile Documents/com~apple~CloudDocs/initiatives/catholic_church/journals/YYYY-MM-DD.md` | `end-of-day.prompt.md` | `weekly-review.prompt.md` |

### HMBL Journals (iCloud)
| Path | Writer | Readers |
|---|---|---|
| `~/Library/Mobile Documents/com~apple~CloudDocs/initiatives/hmbl/journals/YYYY-MM-DD.md` | `end-of-day.prompt.md` | `weekly-review.prompt.md` |

## Reference Context Files (`assistant/context/`)

| File | Purpose | Updated By |
|---|---|---|
| `priorities.md` | Current top priorities and tomorrow's meetings | `briefing-tune.prompt.md`, `morning-briefing.prompt.md` |
| `identity.md` | Role, team, org context | `bonding-refresh.prompt.md` |
| `data-architecture.md` | Query/mutation reference for the system | Manual |
| `triage-rules.md` | Email classification rules | Manual (extracted from morning-briefing) |
| `dashboard-json-schema.md` | Dashboard JSON schema | Manual (extracted from morning-briefing) |

## Log Files (`assistant/automation/logs/`)

All write-only. Naming pattern: `{script}-YYYY-MM-DD.log`

- `morning-briefing-*.log`, `end-of-day-auto-*.log`, `briefing-sync-*.log`
- `meeting-sweep-*.log`, `meeting-recap-sweep-*.log`, `auto-draft-inbox-*.log`
- `midday-sync-*.log`, `reminders-*.log`
- `dashboard.log`, `dashboard.err` (server stdout/stderr)
- LaunchAgent redirects: `briefing-sync-launchd.log`, `launchd-morning-briefing.log`, etc.

## Sentinel Files

| Pattern | Purpose | Created By |
|---|---|---|
| `automation/logs/eod-complete-YYYY-MM-DD.sentinel` | Guards against duplicate EOD runs | `end-of-day-auto.sh` |

## Other State Files

| File | Purpose | R/W |
|---|---|---|
| `state/auto-drafts.log` | Append log of auto-saved email drafts | Append (morning-briefing, draft-inbox) |
| `state/self-critique-log.md` | Append log of weekly self-critique results | Append (self-critique.prompt.md) |

## External Integrations

### Things 3
- Read via: `things3/today.sh`, `search.sh`, `show.sh`, etc.
- Write via: `atlas-db.py` (push_to_things3), `things3/add.sh`, `complete.sh`, `delete.sh`
- Things 3 SQLite (read-only): `~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/.../main.sqlite`

### Contacts
- Work: `~/Library/CloudStorage/OneDrive-Microsoft/01_people/contacts/index.json` + `*.md`
- Church: `~/Library/Mobile Documents/com~apple~CloudDocs/personal/contacts/` (planned)

## In-Memory State (server.js, lost on restart)

- `health` object: tracks last API call results
- `undoBuffer`: recent status changes for 15s undo grace period
- `sideEffectQueue`: retry queue for Things 3 / Graph API side effects

## LaunchAgent Plists

| Plist | Schedule | Script |
|---|---|---|
| `com.atlas.morning-briefing` | M-F 6:30 AM | `morning-briefing.sh` |
| `com.atlas.briefing-sync` | Every 15 min | `briefing-sync.sh` |
| `com.atlas.end-of-day-auto` | M-F 8:00 PM | `end-of-day-auto.sh` |
| `com.atlas.end-of-day-reminder` | M-F 5:15 PM | `end-of-day-reminder.sh` |
| `com.atlas.weekly-review` | Sun 9:00 AM | `weekly-review.sh` |
| `com.atlas.meeting-sweep` | Every 15 min M-F 7AM-6PM | `meeting-sweep.sh` |
| `com.atlas.meeting-recap-sweep` | Every 15 min M-F 7AM-7PM | `meeting-recap-sweep.sh` |
| `com.atlas.auto-draft-inbox` | Every 30 min M-F 8AM-6PM | `auto-draft-inbox.sh` (disabled) |
