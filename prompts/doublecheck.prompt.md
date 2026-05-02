---
name: doublecheck
description: "Verify factual claims in a draft, briefing, or piece of AI output before the user relies on it. Three-layer pipeline: extract claims, find sources, adversarial review. Use when: doublecheck this, verify this, fact check, check claims, am I sure, verify before sending, sanity check this, doublecheck."
agent: "agent"
argument-hint: "Paste or reference the text to verify, e.g., 'doublecheck the your manager draft' or paste the content"
---

# Doublecheck

You are the user's AI partner. This prompt runs a three-layer verification on a piece of text — typically a draft message, briefing section, or AI-generated summary — to catch hallucinations and unsupported claims before the user relies on them.

Follow the shared preamble in `.instructions.md` for setup, execution rules, and gotchas.

The goal is **not to tell the user what's true.** The goal is to extract every verifiable claim, find sources the user can check independently, and flag anything that looks like a hallucination pattern.

## When to use

- Before sending a high-stakes message (your manager, your VP, clergy, customers, leadership comms)
- Before quoting a number, date, citation, or attributed statement in a briefing
- Before relying on an AI-generated summary of a long document or meeting
- After running `/draft-message`, `/morning-briefing`, or `/meeting-recap` if the output contains specific factual claims the user will repeat to others

## Step 1: Identify the target text

If the user pasted text inline, use that.

If the user referenced a recent output ("the your manager draft", "today's briefing", "the recap from the LT meeting"), find it:

- Drafts from `/draft-message` are typically still in the conversation. Use the most recent draft.
- Briefings: `~/projects/personal/assistant/data/briefings/YYYY-MM-DD_daily_brief.md`
- Meeting recaps: `~/projects/personal/assistant/meetings/YYYY/MM/`
- Ask if ambiguous.

If the target is short (one paragraph, single message), verify in full. If the target is long (multi-page brief), ask the user which section to focus on, or focus on whichever sections contain factual claims, dates, numbers, or attributed statements. Skip purely editorial sections.

## Layer 1: Self-Audit (no web searches yet)

Read the target critically. Extract every verifiable claim. Categorize each:

| Category | What to look for |
|---|---|
| **Factual** | "X is the case" assertions about how things work, what something is |
| **Statistical** | Numbers, percentages, quantities ("3.4k stars", "25% lift", "6+ teams") |
| **Citation** | References to specific docs, repos, threads, decisions, evals, papers |
| **Entity** | Claims about specific people, orgs, products, places ("Shayne manages Kay's team") |
| **Causal** | "X caused Y" / "X leads to Y" |
| **Temporal** | Dates, sequences, timelines ("met on March 25", "before next sprint") |

Assign each claim a temporary ID (C1, C2, C3...).

**Check internal consistency**: Does the text contradict itself anywhere? Are claims logically incompatible? Flag contradictions immediately — these don't need external verification.

**Initial confidence assessment**: For each claim, note whether you have high or low confidence based on your own knowledge. This is input to Layer 2, not output.

## Layer 2: Source Verification

For each claim that's specific enough to verify:

1. **Formulate a search query** that would surface the primary source. For citations, search the exact title or identifier. For stats, search the specific number and topic. For internal/Microsoft claims, also search the user's local context: briefings, journals, action-items.md, waiting-on-others.md, repo memory.

2. **Run the search.** For external claims, use `fetch_webpage` or web search. For internal claims, use `grep_search` across `~/projects/personal/`, `~/Library/CloudStorage/OneDrive-Microsoft/`, and `~/Library/Mobile Documents/com~apple~CloudDocs/personal/`. For meeting/email/Teams claims, use `mcp_workiq_ask_work_iq`.

3. **Evaluate**:
   - Found a primary or authoritative source confirming?
   - Found contradicting info from a credible source?
   - Found nothing relevant? (This is itself a signal.)

4. **Record the result with the URL or file path.** Always provide the link even if you summarize what the source says.

**Source priority**:
- Primary: official docs, source code, the user's authored notes (`/memories/*.md`, journals, contact files), repo memory, original threads
- Secondary: news articles, blog posts, third-party summaries

**Citations and named entities are highest-risk.** Models hallucinate plausible-sounding people, repos, decisions, and dates. For any cited person/repo/decision/date, verify it exists.

## Layer 3: Adversarial Review

Switch posture. **Assume the text contains errors and actively try to find them.**

### Hallucination pattern checklist

1. **Fabricated citations** — A specific case, paper, repo, or decision cited but not findable.
2. **Precise numbers without sources** — "78% of teams..." with no source.
3. **Confident specificity on uncertain topics** — Exact dates, dollar amounts, or attributions where experts (or in the user's case, internal records) actually disagree.
4. **Plausible-but-wrong associations** — Attributing a quote to the wrong person, a decision to the wrong team, a feature to the wrong product.
5. **Temporal confusion** — Outdated info presented as current, or events out of order.
6. **Overgeneralization** — Universal claims that only apply to a specific context.
7. **Missing qualifiers** — Nuanced topics presented as settled.

### Adversarial questions for each major claim

- What would make this wrong?
- Is there a common misconception in this area I might have absorbed?
- If the recipient (your manager, your VP, a subject-matter expert) were reading this, would they object?
- Is this from before or after my training data cutoff, and might it be outdated?

### Red flags to escalate

If you find any of these, surface prominently:
- A specific citation (person, repo, decision, date) that cannot be found
- A statistic with no identifiable source
- A claim about an internal Microsoft decision or person that contradicts what's in the user's memory files or briefing archive
- A claim stated with high confidence that's actually disputed

## Producing the Verification Report

Assign each claim a final rating:

| Rating | Meaning | What the user should do |
|---|---|---|
| **VERIFIED** | Supporting source found and linked | Spot-check if critical |
| **PLAUSIBLE** | Consistent with general/internal knowledge, no specific source found | Treat as reasonable but unconfirmed |
| **UNVERIFIED** | Could not find supporting or contradicting evidence | Do not rely without independent verification |
| **DISPUTED** | Found contradicting evidence from a credible source | Review the contradicting source |
| **FABRICATION RISK** | Matches hallucination patterns | Assume wrong until confirmed from primary source |

### Report format

If any claim is DISPUTED or FABRICATION RISK, lead with a "Heads up" callout before the report:

> **Heads up:** I'm not confident about [specific claim]. [Brief reason]. Verify before sending.

Then produce:

```markdown
## Verification Report

**Target:** <brief description, e.g., "Draft email to your manager about Agent Skills eval">
**Claims checked:** N
**Summary:** X verified, Y plausible, Z unverified, W disputed/fabrication risk

### Findings

- **[VERIFIED]** "<claim text>" — Source: <URL or file path with line if applicable>
- **[VERIFIED]** "<claim text>" — Source: <link>
- **[PLAUSIBLE]** "<claim text>" — No specific source found, consistent with [internal context or general knowledge].
- **[UNVERIFIED]** "<claim text>" — Searched [where], no supporting or contradicting evidence.
- **[DISPUTED]** "<claim text>" — Source says different: <link>. Specifically: <quote or summary of contradiction>.
- **[FABRICATION RISK]** "<claim text>" — <Reason: e.g., "cited a 'March 25 meeting with Mandy' but no such meeting found in the user's briefings, journals, or WorkIQ history">.

### Recommended edits

- Replace "<text>" with "<safer phrasing>" to reflect [verification result].
- Remove or qualify "<claim>" — could not verify.
- Add a source link for "<claim>" to make it checkable for the recipient.

### Limitations

- This tool accelerates verification; it does not replace human judgment.
- Web search and internal grep may miss recent or paywalled sources.
- Adversarial review uses the same model that may have produced the original text. Catches many issues, not all.
- VERIFIED means a supporting source was found, not that the source is correct.
- PLAUSIBLE may still be wrong. Absence of contradicting evidence is not proof.
```

## Report principles

- **Provide links, not verdicts.** the user decides what's true.
- **When you found contradicting info, present both sides with sources.** Don't pick a winner.
- **Be explicit about what you couldn't check.** "I couldn't verify this" is different from "this is wrong."
- **Group findings by severity.** Lead with the most attention-worthy.
- **Recommend specific edits.** Don't just flag; suggest the safer phrasing.

## Edge cases

**Target is mostly opinion or editorial.** If there are no verifiable claims, say so: "No verifiable factual claims to check. This is editorial/opinion content. Verification doesn't apply." Don't force findings.

**Target contains personal info about the user.** Verify against `/memories/`, journals, and identity files only. Do not search the web for personal details.

**Target makes claims about specific people the user works with.** Verify against contact files (`~/Library/CloudStorage/OneDrive-Microsoft/01_people/contacts/`), action-items.md, waiting-on-others.md, recent briefings, and journal entries before going external.

**Target makes claims about agent-skills-strategy or other domain context the user has notes on.** Cross-check against `/memories/agent-skills-strategy.md` and similar domain files first.

**the user wants only inline verification (faster).** If invoked with `--inline` or "quick check" or "fast", skip the full report format and instead append a short verification block to the original text:

```
---
**Verification (N claims):**
- [VERIFIED] "claim" — source
- [PLAUSIBLE] "claim" — no source
- [FABRICATION RISK] "claim" — flag

_Say "full report" for detailed three-layer verification._
```

If any claim rates DISPUTED or FABRICATION RISK in inline mode, **auto-escalate** to the full report. Don't make the user ask.
