# Signal Sources

Parallel data sources for the morning briefing and end-of-day agents. All sources in the same group are independent and should be fired simultaneously.

## Group 1: Calendar and Communications (fire in parallel)

| Signal | MCP/Tool | What to fetch | Field projection |
|--------|----------|---------------|-----------------|
| Calendar | `mcp_workiq_ask_work_iq` | All meetings for target date(s) | subject, start, end, duration, attendees, organizer, body/agenda |
| Work email | `mcp_workiq_ask_work_iq` | Unread/new emails since last session | sender, subject, receivedDateTime, bodyPreview, importance |
| Personal email (Outlook) | `mcp_outlook_outlook_inbox` | Recent personal inbox | sender, subject, date, preview |
| Personal email (Gmail) | `mcp_gmail_gmail_inbox` | Recent Gmail inbox | sender, subject, date, preview |
| HMBL email | `mcp_hmbl-mail_outlook_inbox` | Recent HMBL inbox | sender, subject, date, preview |

## Group 2: Task State (fire in parallel with Group 1)

| Signal | Tool | What to fetch | Field projection |
|--------|------|---------------|-----------------|
| Things 3 Today | `~/.local/bin/things3/today.sh` | Today's task list | title, project, tags, when, notes |
| Things 3 Upcoming | `~/.local/bin/things3/upcoming.sh` | Next 3 days | title, project, tags, when |

## Group 3: Context Files (fire in parallel with Groups 1-2)

| Signal | Path | Purpose |
|--------|------|---------|
| Identity | `~/projects/personal/assistant/context/identity.md` | Who Derek is, preferences |
| Priorities | `~/projects/personal/assistant/context/priorities.md` | Current focus areas |
| Action items | `~/projects/personal/assistant/context/action-items.md` | Open action items |
| Waiting on others | `~/projects/personal/assistant/context/waiting-on-others.md` | Blocked on someone |
| Recurring checks | `~/projects/personal/assistant/context/recurring-checks.md` | What's due today |
| Session digest | `~/projects/personal/assistant/context/last-session-digest.md` | Last session carryover |

## Group 4: Backfill (only when gap detected)

| Signal | MCP/Tool | When to use |
|--------|----------|-------------|
| iMessages | `mcp_mac-messages_tool_get_recent_messages` | Weekends only, or gap > 1 day |
| WorkIQ backfill | `mcp_workiq_ask_work_iq` | When last EOD was > 1 day ago |

## Merge Rules

1. **Deduplication**: Same email appearing in both WorkIQ and Outlook MCP counts once. Match on subject + sender + approximate time.
2. **Priority**: WorkIQ data is more complete for work context (has Teams + email + calendar). Use MCP tools for personal email accounts that WorkIQ does not cover.
3. **Failure isolation**: If any source fails, log it and continue. Never block the briefing on a single source. Report failures at the end.
4. **Field projection**: Keep only the fields listed above. Strip HTML bodies, long signatures, and thread history. Aim for <200 chars per item summary.
