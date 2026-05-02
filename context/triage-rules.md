# Briefing Triage Rules

Classification rules for inbound communications. Referenced by `/morning-briefing` Step 1.

## Hard Exclusions

Do not include in the briefing output, regardless of tier:
- Access requests (SharePoint access, permission approvals, distribution-list access, repo access)
- Do not add access requests to "What came in overnight", "Today's tasks", or meeting prep bullets
- Process silently in background maintenance only when explicitly requested

## Priority Tiers

### 🔴 HIGH (surface first, add to Things 3)
- From anyone in chain-of-command UP (manager, VP, skip-level, or above), addressed To: you with ≤5 recipients
- From engineering counterparts at manager's level on active initiatives
- From direct reports OR cross-org skip-down DMs to you 1:1, with ask/decision/escalation tone
- Contains a deadline today or this week
- Matches an active item in `action-items.md` or `waiting-on-others.md`
- Someone delivering something the user is waiting on
- Teams @mention of you (auto-promote one tier from base)
- External-domain sender (outside the user's employer domain) on a topic intersecting `priorities.md`
- Meeting prep needed within 24 hours
- **Aging boost**: unread 2+ business days → escalate one tier. M2-band engineering counterparts use 1-business-day boost.

### 🟡 MEDIUM (review today)
- From PM peers under your manager (PM peers under your manager). HIGH if there's an ask, deadline, or @mention.
- From people named in `priorities.md` as active cross-team partners
- From people one level below the user's peer band (e.g., reports of peers) when addressed directly
- Cross-org partners on active initiatives (DevDiv contacts) when addressed to you
- FYI threads where the user is explicitly To: or @cc'd with needed context
- Responses to threads the user started
- Teams DMs (1:1, not @mentions, not channels) from anyone
- Direct/skip-down reports posting in shared channels the user is in
- **Aging boost**: unread 3+ business days → escalate to HIGH

### 🟢 LOW (batch later or skip)
- Broad distribution (>5 To:/Cc:) where the user has no named role
- Informational channel posts with no @mention
- Social/casual messages
- Skip-up CCs on large distributions
- **Aging boost**: unread 5+ business days → escalate to MEDIUM

## Thread Escalation

Classify per-thread, not per-message. If a MEDIUM thread gets a reply from a HIGH-tier sender (your manager, your VP, or their leadership chain), the entire thread re-classifies as HIGH.

## Action Item Extraction

For every HIGH or MEDIUM item, apply these tests before creating a task:

1. **Explicit ask test**: Direct request, question, decision, or deliverable addressed to the user? Language like "can you", "please", "I need you to", "your thoughts on"? If no explicit ask: no task. Sharing links/resources without a clear ask does not qualify.
2. **Announcement filter**: Kickoff emails, announcements, FYIs, updates where the user has no named role or ask → no task. Briefing context only.
3. **Meeting prep exception**: If directly relevant to a meeting today and no existing prep item in Things 3, a single "Review [topic] before [meeting]" task is acceptable.
4. **Group meeting ask filter**: Only create a task if: (a) request explicitly @mentions the user, AND (b) no visible response already addressing it.
5. **Unaccepted offer filter**: If the user offered to help but no explicit acceptance or follow-up, do not create a task.
6. **Access request filter**: Never include in briefing or create a task.

If a task passes: extract what to do, who it's owed to, source, and deadline.

## Inline Draft Replies

For each 🔴/🟡 email needing a reply, run `/draft-message` Step 2.5 confidence scoring:

| Confidence | Action |
|------------|--------|
| ≥ 0.80 | Save as real Outlook draft via MCP. Add `📝 Draft saved to Outlook (confidence N.NN)` |
| 0.70-0.79 | Generate inline, don't save. Show `📝 Draft ready (confidence N.NN):` with first 2-3 sentences |
| 0.50-0.69 | One-line hint: `📝 Draft available on request (confidence N.NN)` |
| < 0.50 | No draft hint |

Hard exclusions from `/draft-message` Step 2.5 apply (your VP, clergy, brand-new external contacts, sensitivity flags). Never auto-send. Log auto-saved drafts to `assistant/data/state/auto-drafts.log`.
