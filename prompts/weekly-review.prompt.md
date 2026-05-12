---
name: weekly-review
description: "Weekly review across all life contexts. Use when: weekly review, how was my week, week in review, what did I accomplish this week, plan next week, reflect on the week, sunday review."
agent: "agent"
argument-hint: "Optional: specific focus area or anything on your mind going into next week"
---

# Weekly Review

You are the user's personal AI partner. Follow the shared preamble in `.instructions.md` for setup, execution rules, and gotchas.

## Step 1: Gather the week

### Meeting recaps from this week
Query the DB for all recapped meetings this week:
```sh
$ATLAS meeting list --date "$(date -v-7d +%Y-%m-%d)" # start of range
```
Or list all meetings:
```sh
$ATLAS meeting list
```
For each entry with `recap_status=recapped`, read the `recap_file`.

### Daily briefings (primary source)
Read all daily briefing files from this week in `~/projects/personal/assistant/data/briefings/`. Use `ls -t ~/projects/personal/assistant/data/briefings/ | head -7` and read each one. These contain pre-synthesized meeting signals, triaged communications, action items, accountability checks, and task sync reports. This is the richest single source for the week.

Extract from briefings:
- All wins (already confirmed by the user at end-of-day)
- Items that appeared in multiple briefings without resolution (stale items)
- Meeting decisions and action items across the week
- Communication patterns (who was the user interacting with most?)
- Tag trends (which tasks stayed `urgent` or `blocked` all week?)

### Read all journal entries from this week
List and read all `.md` files from the last 7 days in each workspace journal path:
- All contexts: read paths from `data/config.yaml` → `journals.*` map. Each value is a strftime pattern; the directory is its parent. Read all `.md` files from the last 7 days in each directory.
Skip things3-snapshot files and placeholders.

### Team accomplishments (from weekly briefing emails)
the user's direct reports send weekly briefing emails. Use `mcp_mailtools_SearchMessages` to find them:

> Search for emails from the past 7 days matching "weekly update" OR "weekly briefing" OR "weekly summary" from direct reports listed in `/memories/identity.md`.

Then use `mcp_mailtools_GetMessage` to read each one found.

Also check for weekly updates from peer PMs listed in `/memories/identity.md` if they send similar emails.

Extract per person:
- What they shipped or accomplished
- Key decisions made
- Blockers or risks they raised
- Items that need the user's attention or input

### Things 3 — Completed this week
Run in terminal:
```sh
~/.local/bin/things3/completed-week.sh
```

### Things 3 — Current state
Run in terminal:
```sh
~/.local/bin/things3/today.sh
```
```sh
~/.local/bin/things3/anytime.sh
```

### Work context
The daily briefings and journals already contain work context. Only use `mcp_workiq_ask_work_iq` if daily briefings are missing for 2+ days this week:
> "Summarize my key accomplishments, decisions, and open items from the past week."

If any data source fails, note it and continue with what you have.

## Step 2: Synthesize the week

### Score prior week's objectives
Check if objectives exist for the outgoing week:
```sh
$ATLAS objective score --week "$(date -v-7d +%GW%V)"
```
If results come back (e.g., "2/3 completed"), present a brief scorecard:
- Which objectives were completed, dropped, or carried
- One sentence on what made the difference (or didn't)
- Growth framing: "That's progress" even if 1/3

If no objectives existed (first week of the system), skip this section.

### Wins
Pull the `## Wins` section from each daily work journal this week. Combine into a single list, then pick the 5-7 most impactful across all contexts. These are already confirmed by the user at end-of-day, so don't re-derive them.

### Learned / Shifted
Pull `## Learned / Shifted` from each daily journal. Surface any recurring themes or the single biggest shift in thinking this week. Skip days marked "Execution day, no major shifts."

### Team accomplishments
Summarize what each direct report shipped or advanced this week, drawn from their weekly briefing emails. Present as:

| Person | Key accomplishments | Needs from the user |
|--------|-------------------|------------------|
| Collin | ... | ... |
| Daniel | ... | ... |
| (etc.) | ... | ... |

If a team member didn't send an update, flag it: "No weekly update received from [name]."

Also note accomplishments from peer teams (Mark's, Sonia's) if their updates were found.

### Patterns
What themes emerged? Where did the user spend the most energy? Recurring blockers or distractions? Look for items that appeared in daily briefings 3+ times without resolution.

### Unfinished business
What rolled from day to day? What needs a decision vs. just execution? Cross-reference daily briefings for items that persisted all week. Also check:
```sh
$ATLAS commit overdue
$ATLAS commit list --direction mine --status active
$ATLAS commit list --direction theirs --status active
```

### Balance check
How did the week distribute across work, personal, church, and HMBL? Is any context being neglected?

### Relationship drift
Run the drift detector:
```sh
python3 ~/projects/personal/assistant/scripts/relationship-drift.py --markdown
```
Include its output in the weekly summary. For each flagged person, suggest a concrete next step (schedule a 1:1, send a Teams ping, nudge on an open item). If no contacts are flagged, note "No relationship drift flags this week" and move on.

## Step 2.5: Self-critique (system health)

Run the self-critique loop to audit how the assistant system performed this week. This is the automated equivalent of `/briefing-tune` but proactive rather than reactive.

Execute the `/self-critique` prompt logic (see `self-critique.prompt.md`). The critique will:
1. Score five dimensions: Signal-to-Noise, Accuracy, Efficiency, Completeness, Freshness
2. Compare against prior week's critique
3. Generate categorized recommendations (auto-fix, needs discussion, observation)
4. Append results to `assistant/data/state/self-critique-log.md`

Include in the weekly summary a compact `## System Health` section:
- The score table (5 dimensions with trends)
- Top 2-3 auto-fix recommendations for the user's approval
- Any time-sensitive discussion items

If the user approves auto-fixes during the review, apply them immediately. Otherwise, they carry forward to next week.

## Step 3: Set next week's objectives

Propose **exactly 3 objectives** for next week. These are the outcomes that, if achieved, would make the week a success. They must be:
- **Outcome-framed**: What done looks like, not just an activity (e.g., "Ship agent skills eval doc to leadership" not "Work on agent skills")
- **Achievable in 5 days**: Big enough to matter, small enough to finish
- **Spread across contexts**: Ideally 2 work + 1 personal/church/HMBL, but 3 work is fine if the week demands it

For each objective, specify:
1. The outcome statement (concise, verb-led)
2. The context (work, personal, church, HMBL)
3. How you'll know it's done (measurable signal)

Present the 3 proposed objectives to the user for confirmation. Once confirmed (or after user edits), write them:
```sh
$ATLAS objective set --rank 1 --title "Objective 1 text" --context work --status proposed
$ATLAS objective set --rank 2 --title "Objective 2 text" --context work --status proposed
$ATLAS objective set --rank 3 --title "Objective 3 text" --context personal --status proposed
```

Also carry any incomplete objectives from this week that the user wants to retry:
```sh
$ATLAS objective carry --from-week "$(date -v-7d +%GW%V)" --rank 1
```
(Only carry objectives the user explicitly approves. Don't auto-carry without asking.)

## Step 4: Update memory

Update `/memories/priorities.md` with revised priorities for the coming week. The 3 objectives set in Step 3 should anchor the priorities file. Also include any lower-priority items that don't rise to objective level but still need tracking.

## Step 5: Write weekly summaries

Write separate weekly summary files per workspace.

### Work weekly (directory: sibling `weekly/` of the `journals.work` directory in `data/config.yaml`)
Include only work-related wins, team accomplishments table, patterns, unfinished items, and next week work priorities.

### Personal weekly (directory: sibling `weekly/` of the `journals.personal` directory in `data/config.yaml`)
Include personal wins, patterns, unfinished items, balance check, and next week personal priorities.

### Additional context weeklies (for each extra context in `data/config.yaml` → `journals`, only if activity this week)
Write a weekly summary at `<context-journal-dir>/../weekly/YYYY-MM-DD_weekly.md`. Include context-specific wins, activity, and next week priorities.

Create the folder if it doesn't exist. Name files `YYYY-MM-DD_weekly.md` using the Monday date of the week.

Work weekly format:

    # Week of YYYY-MM-DD

    ## Wins
    - [items]

    ## Team Accomplishments
    | Person | Key accomplishments | Needs from the user |
    |--------|-------------------|------------------|
    | ...    | ...               | ...              |

    ## Patterns
    [narrative]

    ## Unfinished
    - [items]

    ## System Health
    | Dimension | Score | Trend |
    |---|---|---|
    | Signal-to-Noise | X/5 | ↑/↓/→ |
    | Accuracy | X/5 | ↑/↓/→ |
    | Efficiency | X/5 | ↑/↓/→ |
    | Completeness | X/5 | ↑/↓/→ |
    | Freshness | X/5 | ↑/↓/→ |
    [Top recommendations, if any]

    ## Next Week Objectives
    1. [objective 1 — with measurable done signal]
    2. [objective 2 — with measurable done signal]
    3. [objective 3 — with measurable done signal]

Personal/Church/HMBL weekly format:

    # Week of YYYY-MM-DD

    ## Wins
    - [items]

    ## Patterns
    [narrative]

    ## Unfinished
    - [items]

    ## Next Week Objectives
    1. [objective if applicable]

After writing all summaries, open the work weekly in Typora:
```sh
open -a Typora "<work-weekly-dir>/YYYY-MM-DD_weekly.md"  # work-weekly-dir = sibling weekly/ of journals.work dir
```

## Step 5b: Sync church workstreams doc

If any church-category tasks in the atlas DB had deadline changes this week (check `synced_deadlines` from the last `$ATLAS sync-things3` output, or compare DB due dates against the workstreams doc), update the parish workstreams document:

```
~/Library/Mobile Documents/com~apple~CloudDocs/initiatives/catholic_church/projects/workstreams-and-priorities.md
```

For each church task whose deadline changed:
1. Find the matching action row in the workstreams doc (match by action number like "1.1", "5a.2", or by title)
2. Update the **Target Date** column to reflect the new date
3. Update the **Status** column if the task was completed
4. Update the **Active Focus** summary table at the top if any workstream status changed

Also update the `*Last Updated:*` line at the top of the file to today's date.

Skip this step if no church task deadlines changed this week.

## Step 6: Update Connects draft

Maintain a running Connects draft at `<work-journal-parent>/connects/current-half.md` (sibling of the work journals directory, from `data/config.yaml` → `journals.work`). This file accumulates across weeks so that by Connects time, the evidence is already assembled.

The draft has three major sections matching Connects evaluation dimensions:
1. **Core Priorities** (individual delivery against agreed priorities)
2. **Manager Excellence** (developing people, team performance, inclusive culture)
3. **Culture & Values** (AI adoption, D&I, One Microsoft, growth mindset)

Each week, append this week's data by pulling from the daily work journals' `## Connects Signals` sections and `## Wins`:

### Core Priorities
Take each Org or Company-scoped win from this week and add it to the matching priority table. Team-scoped wins that represent patterns (3+ similar wins across the half) get promoted too.

### Manager Excellence
- **Developing People**: Any coaching, feedback, career conversations, skill development, or onboarding you did for direct reports this week.
- **Team Performance & Clarity**: Direction-setting, unblocking, accountability improvements, execution improvements.
- **Inclusive Team Culture**: Moments where you built belonging, ensured equitable participation, or amplified diverse perspectives within your team.

### Culture & Values
- **AI Adoption**: Pull from "AI Adoption" Connects signals. How you used or championed Copilot, MCP, agents, or other AI tools.
- **D&I (beyond team)**: ERG participation, hiring practices, mentoring outside team, accessibility advocacy.
- **One Microsoft**: Cross-org collaboration signals from the week (DevDiv, Global Skilling, partner teams).
- **Growth Mindset**: Pull the most significant "Learned/Shifted" entry from this week's journals. Skip weeks that were pure execution.

Do not rewrite prior weeks' entries. Only append new rows and update the "Last updated" date.

Present a one-line summary: "Connects draft updated: X core priority items, Y manager items, Z culture items."

Keep the response to the user concise. Highlight the 2-3 most important things.
