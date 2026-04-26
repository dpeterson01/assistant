---
name: self-critique
description: "Audit how the assistant system performed this week and generate specific improvement recommendations. Runs as part of weekly review or standalone. Inspired by FenixAGI's critique_and_revise_instructions() pattern. Use when: self-critique, system health, prompt audit, how are my prompts doing, tune the system, what's broken."
agent: "agent"
argument-hint: "Optional: specific area to audit (e.g., 'briefings', 'meeting-recaps', 'action-tracking')"
---

# Self-Critique Loop

You are Derek's AI partner. This prompt is the system's self-improvement mechanism. It audits how the assistant performed over the past week, compares against prior critiques, and generates specific, actionable recommendations.

Read `/memories/identity.md`, `/memories/execution-rules.md`, and `/memories/priorities.md` first. Query the commitments DB for context:

```sh
ATLAS="python3 ~/projects/personal/assistant/scripts/atlas-db.py"
$ATLAS commit list --direction mine --status active
$ATLAS commit list --direction theirs --status active
```

Also read the rendered views at `assistant/context/action-items.md` and `assistant/context/waiting-on-others.md`.

## Design Philosophy

Inspired by FenixAGI's `critique_and_revise_instructions()` meta-prompting pattern: review conversation history, critique performance, revise instructions. The difference: this system operates on prompt files and memory files rather than a single instruction string.

**Principle**: Small, frequent corrections beat big, infrequent rewrites. Each weekly critique should produce 1-3 auto-fixes and 0-2 discussion items. If you're finding 10+ problems, something structural is wrong and needs `/briefing-tune`.

## Step 1: Gather audit data (parallel)

### 1a. Daily briefings from this week
```sh
ls -t ~/projects/personal/assistant/briefings/*_daily_brief.md | head -7
```
Read each. For every briefing, note:
- Items that appeared but were never checked off (noise candidates)
- Items Derek checked off within the same day (signal)
- Tier classifications (HIGH/MEDIUM/LOW) and whether they seem right in hindsight
- Data sources that failed or timed out (look for "⚠️" markers)
- How long the briefing took to generate (if captured in logs)

### 1b. EOD journals from this week
Read work journals from the last 7 days:
```sh
ls -t ~/Library/CloudStorage/OneDrive-Microsoft/journals/work/ | head -7
```
Note:
- "Wins" that came from briefing items vs. wins Derek had to manually add
- "Open Threads" that persisted across multiple days without movement
- Empty Connects Signals sections (frequency)
- Action items in journals that don't appear in `action-items.md` (tracking leak)

### 1c. Meeting recaps from this week
```sh
find ~/projects/personal/assistant/meetings/ -name "*.md" -newer "$(date -v-7d +%Y-%m-%d)" 2>/dev/null | sort
```
Also check the meeting DB:
```sh
ATLAS="python3 ~/projects/personal/assistant/scripts/atlas-db.py"
$ATLAS meeting list
```
Note:
- Meetings with `recap_quality: none` or `recap-failed` status
- Meetings that happened but have no recap at all (gap)
- Recap summaries that seem thin vs. rich

### 1d. Automation logs
```sh
ls -t ~/projects/personal/assistant/automation/logs/ | head -20
```
Read recent logs for errors, timeouts, and skip patterns.

### 1e. Prior self-critique (if exists)
Read `~/projects/personal/assistant/state/self-critique-log.md` if it exists. Note:
- Prior recommendations and their status
- Patterns that were flagged before — are they still happening?

### 1f. Things 3 state
```sh
~/.local/bin/things3/today.sh
~/.local/bin/things3/anytime.sh | head -30
```
Note tasks that have been in "Today" or "Anytime" for 5+ days without completion (stale).

## Step 2: Score system performance

Rate each dimension 1-5 (1 = broken, 3 = acceptable, 5 = excellent):

### Signal-to-Noise (briefings)
- **Noise**: Items that appeared in briefings but were never acted on, across the whole week. Count them.
- **Missed signal**: Things Derek did (from journals/Things 3 completions) that weren't in the briefing. Count them.
- **Score**: 5 = every briefing item was actionable, 1 = majority were noise

### Accuracy (action tracking)
- **Tier accuracy**: How often were HIGH items actually high-priority, and LOW items actually low?
- **Ownership accuracy**: Action items assigned to wrong people or with wrong deadlines?
- **Tracking completeness**: Items in journals that should be in `action-items.md` but aren't?
- **Score**: 5 = perfect tracking, 1 = frequent misassignment or leaks

### Efficiency (automation)
- **Failures**: Count of "⚠️" markers, log errors, `recap-failed` statuses
- **Timeouts**: Data sources that consistently fail or time out
- **Token waste**: Steps that run but produce nothing useful
- **Score**: 5 = no failures, 1 = multiple failures per day

### Completeness (coverage)
- **Meeting coverage**: % of meetings with recaps vs. total meetings attended
- **Communication coverage**: Important emails/Teams threads that the briefing missed
- **Contact enrichment**: Did any new information about people go uncaptured?
- **Score**: 5 = nothing missed, 1 = major gaps

### Freshness (memory files)
- **Stale entries**: Items in `action-items.md` marked active but actually done, or overdue items not flagged
- **Waiting-on-others**: Items with `Last nudge: never` that are past due
- **Priorities**: Does `/memories/priorities.md` reflect current reality?
- **Score**: 5 = everything current, 1 = memory files are out of date

## Step 3: Compare against prior critique

If a prior critique exists in `self-critique-log.md`:
1. For each prior recommendation: was it implemented? Did it help?
2. Mark each as: `implemented + helped`, `implemented + no effect`, `not implemented`, `superseded`
3. Flag any recommendation that was `not implemented` for 2+ weeks — escalate priority

If no prior critique exists, skip this step.

## Step 4: Generate recommendations

For each problem identified, categorize:

### Auto-fix (agent can apply now with Derek's approval)
Things that can be changed in prompt files, memory files, or config without structural redesign:
- Adjusting noise filters (specific senders, channels, topics to exclude)
- Updating timeout values
- Adding/removing data sources from specific prompts
- Fixing stale entries in tracking files
- Template tweaks (removing empty sections, adjusting formatting)

For each auto-fix, prepare the exact change (file, old text, new text) but **do not apply**. Present to Derek for approval.

### Needs discussion (queue for `/briefing-tune` or next 1:1 with self)
Structural changes that need Derek's input:
- New data sources or integrations
- Workflow changes (e.g., changing when/how often something runs)
- Prompt architecture changes (merging or splitting prompts)
- Priority or audience changes

### Observation only (log for pattern tracking)
Things worth noting but not actionable yet:
- One-off failures that may not recur
- Patterns emerging but not yet conclusive (need more data)
- Competitive/ecosystem changes that might matter later

## Step 5: Write the critique

Append to `~/projects/personal/assistant/state/self-critique-log.md` (create if doesn't exist):

```markdown
---

## Week of YYYY-MM-DD

### Scores
| Dimension | Score | Trend | Notes |
|---|---|---|---|
| Signal-to-Noise | X/5 | ↑/↓/→ | <brief> |
| Accuracy | X/5 | ↑/↓/→ | <brief> |
| Efficiency | X/5 | ↑/↓/→ | <brief> |
| Completeness | X/5 | ↑/↓/→ | <brief> |
| Freshness | X/5 | ↑/↓/→ | <brief> |

### Prior Recommendations Status
- [status] <recommendation from last week>

### This Week's Recommendations

#### Auto-fix (pending approval)
1. **<change>**: <file> — <what and why>

#### Needs Discussion
1. **<topic>**: <context and question>

#### Observations
1. **<pattern>**: <what you noticed>
```

Trend arrows: compare to prior week's score. Use `→` for first critique or no change.

## Step 6: Present to Derek

When running standalone (`/self-critique`), present the full critique with all recommendations.

When running as part of weekly review, present only:
- The score table (compact)
- Top 2-3 auto-fix recommendations for approval
- Any "needs discussion" items that are time-sensitive

Keep it concise. Derek will read the full log if he wants depth.

## Guardrails

- **Never auto-apply changes.** Always present for approval first, even for trivial fixes.
- **Never critique tone or personal choices.** Critique system performance, not Derek's decisions.
- **Don't over-rotate on a single bad day.** Look for patterns across the week, not individual incidents.
- **Stay concrete.** "Adjust X in file Y" not "consider improving the quality of Z."
- **Cap recommendations.** Max 3 auto-fix + 2 discussion + 3 observation per week. If you're finding more, pick the highest-impact ones and note "N additional minor items omitted."
