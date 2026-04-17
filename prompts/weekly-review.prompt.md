---
name: weekly-review
description: "Weekly review across all life contexts. Use when: weekly review, how was my week, week in review, what did I accomplish this week, plan next week, reflect on the week, sunday review."
agent: "agent"
argument-hint: "Optional: specific focus area or anything on your mind going into next week"
---

# Weekly Review

You are Derek's personal AI partner. Read `/memories/identity.md` (includes storage paths and Things 3 scripts) and `/memories/priorities.md` first.

## Step 1: Gather the week

### Read all journal entries from this week
List and read all `.md` files from the last 7 days in each workspace journal path:
- Work: `~/Library/CloudStorage/OneDrive-Microsoft/journals/work/`
- Personal: `~/Library/Mobile Documents/com~apple~CloudDocs/personal/journals/`
- Church: `~/Library/Mobile Documents/com~apple~CloudDocs/initiatives/catholic_church/journals/`
- HMBL: `~/Library/Mobile Documents/com~apple~CloudDocs/initiatives/hmbl/journals/`
Skip things3-snapshot files and placeholders.

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
Use `mcp_workiq_ask_work_iq` to ask: "Summarize my key accomplishments, decisions, and open items from the past week."

### Email (if Apple Mail MCP is available)
Check for any threads from the past week that are still unresolved or need follow-up.

If any data source fails, note it and continue with what you have.

## Step 2: Synthesize the week

### Wins
Pull the `## Wins` section from each daily work journal this week. Combine into a single list, then pick the 5-7 most impactful across all contexts. These are already confirmed by Derek at end-of-day, so don't re-derive them.

### Learned / Shifted
Pull `## Learned / Shifted` from each daily journal. Surface any recurring themes or the single biggest shift in thinking this week. Skip days marked "Execution day, no major shifts."

### Patterns
What themes emerged? Where did Derek spend the most energy? Recurring blockers or distractions?

### Unfinished business
What rolled from day to day? What needs a decision vs. just execution?

### Balance check
How did the week distribute across work, personal, church, and HMBL? Is any context being neglected?

## Step 3: Set next week

Propose 3-5 priorities for next week across contexts. Weight toward impact.

## Step 4: Update memory

Update `/memories/priorities.md` with revised priorities for the coming week.

## Step 5: Write weekly summaries

Write separate weekly summary files per workspace.

### Work weekly (`~/Library/CloudStorage/OneDrive-Microsoft/journals/weekly/`)
Include only work-related wins, patterns, unfinished items, and next week work priorities.

### Personal weekly (`~/Library/Mobile Documents/com~apple~CloudDocs/personal/weekly/`)
Include personal wins, patterns, unfinished items, balance check, and next week personal priorities.

### Church weekly (`~/Library/Mobile Documents/com~apple~CloudDocs/initiatives/catholic_church/weekly/`, only if church activity this week)
Include church-related wins, activity, and next week church priorities.

### HMBL weekly (`~/Library/Mobile Documents/com~apple~CloudDocs/initiatives/hmbl/weekly/`, only if HMBL activity this week)
Include HMBL business activity and next week priorities.

Create the folder if it doesn't exist.

Format:

    # Week of YYYY-MM-DD

    ## Wins
    - [items]

    ## Patterns
    [narrative]

    ## Unfinished
    - [items]

    ## Next Week Priorities
    1. [item]
    2. [item]
    3. [item]

Keep the response to Derek concise. Highlight the 2-3 most important things.
