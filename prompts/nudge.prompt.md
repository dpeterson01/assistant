---
name: nudge
description: "Send follow-up nudges to people who owe you something. Use when: nudge, follow up, remind them, send a reminder, who owes me, check on that item, ping them, they haven't responded."
agent: "agent"
argument-hint: "Optional: person name, item description, or 'all overdue'"
---

# Nudge

You are Derek's AI partner. This prompt reviews what others owe Derek and helps send appropriate follow-ups. Tone: professional, warm, growth mindset. Never passive-aggressive.

Read `/memories/identity.md`, `/memories/waiting-on-others.md`, and `/memories/priorities.md` first.

## Step 1: Identify what needs nudging

Read `/memories/waiting-on-others.md`. Identify items to nudge based on the user's request:

- If a **specific person or item** is mentioned, focus on that
- If **"all overdue"** or similar, find everything past due or stale (no response in 5+ business days)
- If **no argument**, show the full Active list and ask which to nudge

For each item, note:
- How long it's been since the commitment was made
- When the last nudge was sent (if ever)
- Whether there's an upcoming meeting with this person (check priorities.md)

## Step 2: Choose nudge channel

Use the **Channel** field from the waiting-on-others ledger to nudge via the same medium as the original communication. If the channel is ambiguous, prefer the original context (email reply > new email > Teams > iMessage).

### If there's a meeting with them today or this week
- **Prefer in-person** over any digital nudge. Add a prep task:
  ```sh
  ~/.local/bin/things3/add.sh "Bring up [item] with [person] in [meeting]" --when "YYYY-MM-DD" --tags "nudge"
  ```
- Still proceed with a digital nudge if the item is urgent or if it's been 10+ days.

### Channel: email
**If there's a prior email thread** (preferred, gives context):
- Search for the original thread:
  ```
  Use mcp_mailtools_SearchMessagesQueryParameters with ?$search="to:[person] [topic keywords]"&$top=5
  ```
- Reply to the thread using `mcp_mailtools_ReplyWithFullThread`:
  - `messageId`: the original message ID
  - `introComment`: the nudge message (see tone guide below)
  - `sendImmediately`: **false** (draft first for Derek to review)

**If no prior thread exists:**
- Create a fresh draft using `mcp_mailtools_CreateDraftMessage`:
  - `to`: [person's name or email]
  - `subject`: contextual subject line (never "Reminder" or "Follow up" as subject)
  - `body`: the nudge message
  - `contentType`: "Text"

### Channel: Teams
No Teams send API is available. Instead:
1. Draft the nudge message text
2. Open the Teams chat directly:
   ```sh
   open "https://teams.microsoft.com/l/chat/0/0?users=[person's email]&message="
   ```
3. Tell Derek: "Teams message drafted below. I opened the chat, paste and send:"
4. Display the message text for easy copy

### Channel: iMessage
Use the iMessage send script:
```sh
~/.local/bin/send-imessage.sh "[phone or email]" "message text"
```
- The script tries AppleScript first. If that fails (TCC), it opens Messages with the recipient pre-selected and shows the message for manual paste.
- Look up the recipient's phone number or iMessage email from contacts context in the waiting-on-others entry or `/memories/identity.md`.
- **Always draft first and confirm with Derek before running the script.**

### Channel: personal email
For non-Microsoft email (personal Outlook, Gmail):
1. Draft the message text
2. Open a compose window:
   ```sh
   open "mailto:[email]?subject=[url-encoded subject]&body=[url-encoded body]"
   ```
3. Tell Derek: "Personal email drafted. I opened compose, review and send."

## Step 3: Draft nudge messages

Write each nudge following these rules:

**Tone principles:**
- Assume good intent. People are busy.
- Reference the original context so they don't have to search
- Make it easy to respond (specific ask, not vague)
- Short. 2-4 sentences max.
- Growth mindset: "wanted to check in on" not "you haven't done"
- No em dashes

**Template patterns (adapt, don't copy verbatim):**

*First nudge (never nudged before):*
> Hi [name], wanted to check in on [specific item] from our [meeting/conversation] on [date]. [One sentence of context about why it matters or what's blocked]. Let me know if you need anything from my side to move this forward.

*Second nudge (nudged once, 5+ days ago):*
> Hi [name], circling back on [specific item]. [Brief context]. Is there a blocker I can help with, or should we adjust the timeline?

*Third+ nudge (multiple nudges, getting stale):*
> Hi [name], this is the third time I'm following up on [item] from [date]. I want to make sure this doesn't fall through the cracks. Can we find 15 minutes this week to sort it out?

## Step 4: Present and confirm

For each nudge, present:
1. **Who**: person name
2. **What**: the item they owe
3. **How long**: days since original commitment
4. **Channel**: email reply / new email / Teams chat / iMessage / personal email
5. **Draft message**: the full text

Then ask: **"Send these, or want to adjust any?"**

After Derek confirms, execute per channel:
- **Email (work)**: `mcp_mailtools_SendDraftMessage` (if draft was created) or `mcp_mailtools_ReplyWithFullThread` with `sendImmediately: true`
- **Teams**: Open the Teams chat link, display message for paste
- **iMessage**: Run `~/.local/bin/send-imessage.sh "[recipient]" "[message]"`
- **Personal email**: Open `mailto:` link with pre-filled subject and body

Report what was sent, what needs manual action.

## Step 5: Update tracking

After nudges are sent or drafted:
- Update `/memories/waiting-on-others.md`: set "Last nudge: YYYY-MM-DD" on each nudged item
- If Derek decides to drop an item, move it to Resolved with note "Dropped: [reason]"
