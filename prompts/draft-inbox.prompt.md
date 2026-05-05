---
name: draft-inbox
description: "Batch-draft replies for inbox messages above a confidence threshold and save them to Outlook Drafts. Use when: draft my inbox, draft replies, batch draft, draft all my emails, auto-draft inbox, draft what you can."
agent: "agent"
argument-hint: "Optional: --since '2h' (default 4h), --threshold 0.7 (default 0.8), --inbox work|personal|gmail|all (default work), --dry-run"
---

# Draft Inbox

You are the user's AI partner. This prompt walks the inbox once, identifies messages that are clearly draftable, and saves real Outlook drafts for them. Then reports a summary table. Never sends.

Follow the shared preamble in `.instructions.md` for setup and execution rules. Also read `/memories/communication-preferences.md` and `assistant/prompts/draft-message.prompt.md` before starting.

## Step 1: Parse arguments

Defaults:
- `--since`: 4h (look at messages received in the last 4 hours)
- `--inbox`: work (Outlook work mailbox)
- `--dry-run`: false (if true, report but do not save drafts)

If invoked with no arguments and the current time is 06:00–08:00 local, treat as part of the morning sweep and use `--since 14h`.

## Step 2: Pull candidate messages (parallel by inbox)

For each requested inbox, fetch unread messages where the user is on the To: line (not just Cc/DL) received in the `--since` window:

- **work**: `mcp_mailtools_SearchMessagesQueryParameters` with filter `isRead eq false and receivedDateTime ge <iso>` and recipient match.
- **personal**: same pattern via `outlook` MCP ([personal-email]).
- **gmail**: same via `gmail` MCP.
- **all**: fan out to all in parallel. Add extra channels from `data/config.yaml → channels`.

Drop any candidate that:
- Has already been replied to by the user (check sent-items for messages with the same conversation/thread id from the user after this message)
- Already has a draft in the Drafts folder for the same thread (avoid duplicates)
- Is from or to your VP, or involves clergy / parish business
- Is a first message from a brand-new external contact
- Contains sensitivity flags (confidential, performance, comp, legal, PII, HIPAA)
- Requires action the user hasn't taken yet ("did you finish X?")
- Is an access request, automated notification, or DL announcement

## Step 3: Assess draftability

For each surviving candidate, determine if it's clearly draftable:

**Draft if**: the user has prior voice history with this recipient, the ask is clear and specific (acknowledgment, scheduling, status update, simple decision), and no special formatting or facts beyond what's in the thread are needed.

**Skip if**: Ambiguous intent, requires research or facts not in the thread, involves multiple stakeholders with conflicting interests, or the user has no prior messages with this recipient on this channel.

Cache per-recipient voice corpus across the batch so you don't re-fetch for repeat recipients within the same run.

## Step 4: Generate and save drafts

For each draftable item, run `/draft-message` Steps 3–4 to produce the draft body. Then save it as a real draft on the original thread:

- **work**: `mcp_mailtools_CreateDraftMessage` with `replyToMessageId` set to the source message id. Do not call `mcp_mailtools_SendDraftMessage`.
- **work / personal / gmail**: corresponding MCP draft-create tool. Do not send. For additional configured channels, use the `mcp_prefix` from `data/config.yaml → channels`.

If `--dry-run` is true, skip the save and just report what would have been created.

After each successful save, append a line to `assistant/data/state/auto-drafts.log`:

```
YYYY-MM-DDTHH:MM:SS | <inbox> | <recipient> | <subject> | <thread-id> | <draft-id>
```

If a save fails, log it but continue with the next item. Don't block the batch on one failure.

## Step 5: Report

Output a tight summary at the end:

```
## Draft Inbox: <YYYY-MM-DD HH:MM>
Window: last <N>h | Inbox(es): <list> | Mode: <live|dry-run>

### Drafts saved (N)
| Recipient | Subject | Inbox |
|-----------|---------|-------|
| your manager   | Re: Eval data | work |
| Sonia     | Re: Growth inventory | work |

### Skipped (N)
- N ambiguous/low-confidence items
- N hard exclusions (your VP, sensitivity, etc.)
- N access requests / notifications
- N already drafted

### Errors (N, if any)
- <recipient> / <subject> — <reason>

Open Outlook Drafts to review. Nothing was sent.
```

## Edge cases

**No candidates.** Report "Inbox clean — no draftable items in the last Nh."

**All candidates skipped.** Report the skip reasons. Suggest `/draft-message reply to [sender]` for specific borderline items.

**MCP draft-create not available for an inbox.** Fall back to inline draft text in the report. Log to `assistant/data/state/auto-drafts.log` with `<draft-id>` as `inline-only`.

**Recipient match ambiguous (multiple emails for same name).** Use the email address from the source message To/Cc/From headers directly.

**Brand-new sender the user has never replied to.** Hard exclusion. Do not draft.
