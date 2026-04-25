---
name: draft-inbox
description: "Batch-draft replies for inbox messages above a confidence threshold and save them to Outlook Drafts. Use when: draft my inbox, draft replies, batch draft, draft all my emails, auto-draft inbox, draft what you can."
agent: "agent"
argument-hint: "Optional: --since '2h' (default 4h), --threshold 0.7 (default 0.8), --inbox work|personal|hmbl|gmail|all (default work), --dry-run"
---

# Draft Inbox

You are Derek's AI partner. This prompt walks the inbox once, scores every candidate reply via the `/draft-message` Step 2.5 confidence rubric, and saves real Outlook drafts for everything above threshold. Then reports a summary table. Never sends.

This is a batched, on-demand version of the inline auto-draft behavior in `/morning-briefing`. Used both manually and by the scheduled `auto-draft-inbox` job.

Read `/memories/identity.md`, `/memories/communication-preferences.md`, `/memories/action-items.md`, `/memories/waiting-on-others.md`, and `assistant/prompts/draft-message.prompt.md` (especially Step 2.5) before starting.

## Execution Rules

Follow `/memories/execution-rules.md`. Parallelize per-message scoring where possible. Hard timeout per message: 60s. Hard timeout for the whole run: 10 minutes.

## Step 1: Parse arguments

Defaults:
- `--since`: 4h (look at messages received in the last 4 hours)
- `--threshold`: 0.80 (only save drafts at this confidence or higher)
- `--inbox`: work (Outlook work mailbox)
- `--dry-run`: false (if true, score and report but do not save drafts)

If invoked with no arguments and the current time is 06:00–08:00 local, treat as part of the morning sweep and use `--since 14h --threshold 0.80`. If invoked between scheduled runs (00, 15, 30, 45 of an hour) by the cron, use `--since 30m --threshold 0.80`.

## Step 2: Pull candidate messages (parallel by inbox)

For each requested inbox, fetch unread messages where Derek is on the To: line (not just Cc/DL) received in the `--since` window:

- **work**: `mcp_mailtools_SearchMessagesQueryParameters` with filter `isRead eq false and receivedDateTime ge <iso>` and recipient match.
- **personal**: same pattern via `outlook` MCP (drp80@outlook.com).
- **hmbl**: same via `hmbl-mail` MCP.
- **gmail**: same via `gmail` MCP.
- **all**: fan out to all four in parallel.

Drop any candidate that:
- Has already been replied to by Derek (check sent-items for messages with the same conversation/thread id from Derek after this message)
- Already has a draft in the Drafts folder for the same thread (avoid duplicates)
- Matches a hard exclusion in `/draft-message` Step 2.5 (Curtis, Father Francisco, brand-new external, sensitivity flags, action-not-yet-taken)
- Is an access request, automated notification, or DL announcement (apply `/morning-briefing` triage hard exclusions)

## Step 3: Score each candidate

For each surviving candidate, run the `/draft-message` Step 2.5 confidence rubric. Important: this requires reading recent sent history per recipient. Cache per-recipient voice corpus across the batch so you don't re-fetch for repeat recipients within the same run.

Tier the results:
- **A** (≥ threshold, default 0.80): draft and save
- **B** (0.70 to threshold): list as "draftable on request" in the report
- **C** (0.50–0.69): mention count only
- **D** (< 0.50): drop

## Step 4: Generate and save drafts (Tier A only)

For each Tier A item, run `/draft-message` Steps 3–4 to produce the draft body. Then save it as a real draft on the original thread:

- **work**: `mcp_mailtools_CreateDraftMessage` with `replyToMessageId` set to the source message id. Do not call `mcp_mailtools_SendDraftMessage`.
- **personal / gmail / hmbl**: corresponding MCP draft-create tool. Do not send.

If `--dry-run` is true, skip the save and just report what would have been created.

After each successful save, append a line to `assistant/state/auto-drafts.log`:

```
YYYY-MM-DDTHH:MM:SS | <inbox> | <recipient> | <subject> | <confidence> | <thread-id> | <draft-id>
```

If a save fails, log it but continue with the next item. Don't block the batch on one failure.

## Step 5: Report

Output a tight summary at the end:

```
## Draft Inbox: <YYYY-MM-DD HH:MM>
Window: last <N>h | Threshold: 0.NN | Inbox(es): <list> | Mode: <live|dry-run>

### Drafts saved (N)
| Confidence | Recipient | Subject | Inbox |
|------------|-----------|---------|-------|
| 0.92       | Heather   | Re: Eval data | work |
| 0.85       | Sonia     | Re: Growth inventory | work |

### Draftable on request (N) — say `/draft-message reply to [sender]` to expand
- 0.74 — Mark Russinovich — Re: ARC strategy
- 0.71 — Brenda Alford — Re: Confirmation banners

### Lower confidence (N): not drafted
N items between 0.50 and 0.69. M items below 0.50.

### Skipped (N) — exclusions applied
- 2 from Curtis (hard exclusion)
- 1 sensitivity flag (compensation)
- 4 access requests
- 1 already drafted

### Errors (N, if any)
- <recipient> / <subject> — <reason>

Open Outlook Drafts to review. Nothing was sent.
```

If invoked from cron (no TTY), also fire a macOS notification when ≥1 draft was saved:

```sh
osascript -e 'display notification "N drafts ready in Outlook (avg conf 0.NN)" with title "Atlas" subtitle "Auto Draft" sound name "Glass"'
```

## Edge cases

**No candidates.** Report "Inbox clean — no draftable items in the last Nh." Skip notification.

**All candidates below threshold.** Report the C/D counts, suggest running `/draft-inbox --threshold 0.70` if Derek wants the borderline ones drafted too.

**MCP draft-create not available for an inbox.** Fall back to inline draft text in the report, do not pretend a draft was saved. Log to `assistant/state/auto-drafts.log` with `<draft-id>` as `inline-only`.

**Recipient match ambiguous (multiple emails for same name).** Use the email address from the source message To/Cc/From headers directly. Do not invoke `find_contact` resolution.

**Long thread with prior Derek participation.** Fine to draft. Voice corpus is stronger.

**Brand-new sender Derek has never replied to.** Hard exclusion already drops these. Do not draft.

**Confidence calculation cache miss.** If voice corpus for a recipient isn't fetchable, drop confidence by 0.10 and re-evaluate against threshold. If still below, treat as Tier B/C/D.
