# Recurring Checks

Tasks that should run on a schedule. The morning-briefing and end-of-day agents
consult this file and trigger any check that is due.

## Format

Each entry has:
- **task**: What to run (skill name or command)
- **frequency**: How often (daily, weekdays, weekly:MON, biweekly, monthly:1)
- **preferred_time**: morning or eod (which agent should run it)
- **last_run**: ISO date of last execution (agents update this after running)
- **workspace**: Which VS Code workspace to run in (if applicable)
- **notes**: Context for the agent

## Checks

### ADO Hygiene (personal)
- **task**: Run `/ado-hygiene` with scope `mine`
- **frequency**: weekly:WED
- **preferred_time**: morning
- **last_run**: —
- **workspace**: ecosystems-product
- **notes**: Quick personal hygiene sweep. If issues found, add to Things 3.

### Pod Assignments
- **task**: Run `/pods`
- **frequency**: weekly:MON
- **preferred_time**: morning
- **last_run**: —
- **workspace**: ecosystems-product
- **notes**: Refresh pod dashboard for the week. Already noted as a Monday footnote in briefing.

### Initiative Overview Sync
- **task**: Run `/initiative-update-from-ado` at structure depth
- **frequency**: biweekly (sprint boundaries)
- **preferred_time**: eod
- **last_run**: —
- **workspace**: ecosystems-product
- **notes**: Sync initiative overview titles, dates, and hierarchy with ADO. Run at sprint end.

### Stale Action Items
- **task**: Scan `action-items.md` for items older than 7 days without progress
- **frequency**: weekdays
- **preferred_time**: morning
- **last_run**: —
- **workspace**: n/a (personal context file)
- **notes**: Flag in briefing as ⚠️ overdue. Already partially covered by accountability check.

### Waiting-on-Others Nudge Check
- **task**: Scan `waiting-on-others.md` for items older than 5 business days
- **frequency**: weekly:TUE,THU
- **preferred_time**: morning
- **last_run**: —
- **workspace**: n/a (personal context file)
- **notes**: Suggest nudge messages for stale items. Use /nudge agent if available.

# EOD run marker
last_eod_run: 2026-05-11
