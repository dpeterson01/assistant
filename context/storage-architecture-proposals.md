# Storage & Architecture Proposals from Session 6cd6ea5c

Extracted from the conversation transcript on 2026-04-26. This captures the full thread of storage/architecture discussions.

---

## Conversation Flow

### User Question 1 (Line 2148)
> Is there a more efficient way to store the data (e.g., a database with columns like work item, details, if it is owed to me or by, who is it to, etc.)?

### Assistant Response 1: Initial SQLite Proposal (Line 2157)

Good question. Short answer: **yes, but SQLite is probably the sweet spot**, not a full database server. Here's my thinking:

#### Current pain points with markdown

1. **Two files with overlapping schemas** (action-items.md, waiting-on-others.md) that differ only by direction (owed by me vs. owed to me)
2. **Pipe-delimited fields** are fragile to parse and easy to break
3. **Completed items** accumulate and need manual pruning
4. **No queryability**: "show me everything overdue" or "what do I owe your manager?" requires full-text parsing
5. **Things 3 sync** has to regex-match Task IDs from free text
6. **Duplicate storage** between `/memories/action-items.md` and `assistant/context/action-items.md`

#### Recommended: SQLite

A single `commitments.db` file with one table:

```sql
CREATE TABLE commitments (
    id          TEXT PRIMARY KEY,   -- e.g. AI-20260425-094637
    title       TEXT NOT NULL,
    direction   TEXT NOT NULL,      -- 'mine' or 'theirs'
    person      TEXT NOT NULL,      -- who it's owed to/by
    source      TEXT,               -- email/Teams/GitHub + date
    channel     TEXT,               -- for nudges: email, Teams, etc.
    due_date    TEXT,               -- ISO date or 'ASAP'
    status      TEXT DEFAULT 'active',  -- active, completed, cancelled
    things3_id  TEXT,               -- Things 3 task UUID
    created_at  TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    last_nudge  TEXT,               -- last nudge timestamp
    notes       TEXT
);

CREATE INDEX idx_status ON commitments(status);
CREATE INDEX idx_direction ON commitments(direction);
CREATE INDEX idx_person ON commitments(person);
```

#### Why SQLite over other options

| Option | Verdict |
|--------|---------|
| **SQLite** | Single file, zero config, Python stdlib, queryable, portable, git-friendly enough |
| **JSON file** | Better than markdown but still no indexing, grows unwieldy |
| **Postgres/MySQL** | Overkill, requires a server process |
| **Notion/Airtable** | External dependency, API latency, breaks offline |
| **Things 3 as source of truth** | Can't store direction, source, nudge history, or custom fields |

#### What this unlocks

- `SELECT * FROM commitments WHERE status='active' AND due_date < date('now')` for overdue items
- `SELECT * FROM commitments WHERE person='your manager' AND direction='mine'` for "what do I owe your manager?"
- Briefing/EOD agents write structured rows instead of regex-editing markdown
- Auto-pruning: `UPDATE commitments SET status='archived' WHERE completed_at < date('now', '-14 days')`
- Nudge agent queries `last_nudge` directly instead of parsing pipe-delimited text
- Dashboard can query the DB directly instead of parsing markdown

#### Migration path

1. Create `~/.local/share/assistant/commitments.db` with the schema above
2. Write a one-time migration script to parse both markdown files into rows
3. Update briefing/EOD agents to read/write the DB instead of markdown
4. Generate markdown views on demand (for human reading) rather than using markdown as the data store
5. Remove the duplicate memory file

---

### User Question 2 (Line 2159)
> That is looking promising but lets do more research first. Look at a bunch of other sources and investigate how they do things like this. I am effectively building a personal assistant. I would like to be able to eventually interact with this on mobile too (maybe I use Things 3 as effectively a cached version that I can interact with).

---

### Assistant Response 2: Comprehensive Research & Architecture Options (Line 2220)

#### 1. What Other Systems Do

| System | Storage | Data Model | Mobile | Key Insight |
|--------|---------|------------|--------|-------------|
| **Khoj** (34k stars) | Postgres + pgvector | Unstructured docs + semantic search. Django ORM models. | Browser, Obsidian, WhatsApp, Desktop, Phone | Personal AI as a *service* you query, not a structured DB you maintain |
| **Mem0** (54k stars) | Vector store (Qdrant default) + Postgres + SQLite for history | Memories are semantic observations, not structured rows. ADD-only, never overwrites. Entity linking. | SDK/API | Memory as an append-only log of facts, not a table of tasks |
| **Monica CRM** (24k stars) | MySQL/Postgres via Laravel | Relational: contacts, activities, reminders, relationships, notes, tasks, addresses, pets, life events. Multiple vaults. | Web (responsive) | Full relational model for relationships, but no mobile-native story |
| **BabyAGI** (22k stars) | SQLite function store | Graph of functions + execution logs. Tasks are function calls. | Dashboard only | Task = function to execute, not a row in a table |
| **AutoGPT** | Postgres + Redis | Block-based workflow graph. | Web UI only | Overkill for personal data |

**Key takeaway**: None of these are great models for *your* specific problem (structured commitment tracking with mobile access). Monica is closest conceptually (PRM = track relationships + commitments) but is a full PHP/Laravel web app. The AI memory systems (Mem0, Khoj) treat data as unstructured observations, not structured commitments.

#### 2. Things 3 Integration Capabilities (Deep Dive)

Things 3 has **three** integration surfaces:

**a) URL Scheme** (what your shell scripts already use)
- `things:///add`, `things:///update`, `things:///json` (batch create/update)
- Supports: title, notes (10k chars), when, deadline, tags, checklist items, project, area, heading
- `update` requires auth-token (your scripts already extract this from the SQLite DB)
- **Rate limit**: 250 items per 10 seconds
- Returns created item IDs via `x-callback-url`

**b) Shortcuts Actions** (iOS 17+, macOS 14+)
- Full CRUD: Create To-Do, Edit Items, Find Items, Delete Items, Show Items
- **Find Items** is powerful: filter by title, parent, tags, status, dates, notes content, ID. Sort by any date field. Max 500 results.
- Returns rich `Item` objects with: Type, Title, Parent, Heading, Start, Start Date, Deadline, Tags, Status, Completion Date, Notes, Checklist, Creation Date, Modification Date, ID, Parent ID
- **Edit Items** can modify any property including tags, status, notes (append/prepend), checklist
- Works on **all** Apple devices (Mac, iPhone, iPad, Vision)

**c) Direct SQLite read** (what your `search.sh` and `show.sh` already do)
- Read-only queries against `TMTask` table in `~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/`
- Fast, rich data access including packed date fields
- **Mac-only**, database syncs via iCloud but isn't directly queryable on iOS

#### 3. Things 3 Data Model (What It Can Store Per Task)

| Field | Max Size | Your Use |
|-------|----------|----------|
| Title | ~4000 chars | Commitment description |
| Notes | 10,000 chars | Rich metadata: source, channel, Task ID, details |
| Tags | Unlimited count | `mine`, `theirs`, `overdue`, person name, channel |
| Checklist | 100 items | Sub-tasks or steps |
| Project | 1 per task | "Action Items" or "Waiting On Others" |
| Area | 1 per task | Work, Personal, Church |
| Heading | 1 per task | Group within project (e.g., by person) |
| When/Start Date | Date + optional time | When it's active |
| Deadline | Date | Due date |
| Status | Open/Completed/Canceled | Current state |

#### 4. The Architecture Spectrum

##### Option A: Things 3 as Source of Truth + Markdown as Reports (Simplest)

```
Things 3 (source of truth)
  ├── Project: "Action Items (Mine)"
  │   └── Tasks with tags: person name, source channel
  ├── Project: "Waiting On Others"
  │   └── Tasks with tags: person name, due status
  └── Notes field stores: Task ID, source, channel, details
  
Markdown files (action-items.md, waiting-on-others.md)
  └── Generated reports, read by agents for context
```

**How it works**: Things 3 IS the database. Your agent reads data via direct SQLite queries on Mac. Your agent writes via URL scheme. Mobile access is native Things 3. The markdown files become generated views/reports rather than the source of truth.

**Pros**: Zero new infrastructure. Native mobile. Things 3 sync (iCloud) handles multi-device. Already 80% built.
**Cons**: No custom fields beyond notes/tags. Notes field becomes a "poor man's JSON" for metadata. Things 3 search is limited to title/notes text matching.

##### Option B: SQLite as Source of Truth + Things 3 as Cache (Middle Ground)

```
commitments.db (SQLite, source of truth)
  └── commitments table with full schema
      
  ↕ sync layer (Python script)

Things 3 (mobile-friendly view + interaction layer)
  └── Mirrors active commitments as tasks
  └── Changes detected via polling or Shortcuts automation
  
Markdown files
  └── Generated from SQLite for agent context
```

**How it works**: A `commitments.db` SQLite database stores the full structured data (direction, person, source, channel, due date, last nudge date, etc.). A sync script pushes changes to Things 3 and pulls completions back. Things 3 is the "mobile frontend."

**Pros**: Full relational queries. Clean schema. Easy to add fields. Agent can query with SQL. Things 3 provides native mobile.
**Cons**: Bidirectional sync is the hard part. Need to detect completions in Things 3 and reconcile. Two sources of data that can drift.

##### Option C: SQLite + Things 3 + Semantic Layer (Most Capable)

Same as Option B, but adds a vector/embedding layer (like Mem0's approach) for natural language queries. Overkill for your current scale (16 active + 11 waiting = 27 items).

#### 5. Local-First Architecture Insights

The "local-first" movement (Ink & Switch, Peter van Hardenberg) has a key insight relevant to your setup:

> "Offline is just online with extreme latency"

Your architecture is already local-first by nature: markdown files on disk, Things 3 on device, SQLite queryable locally. The question is just about **authority** (which copy is the truth?) and **reconciliation** (how do you merge changes?).

For your scale (tens of items, not thousands), the reconciliation problem is trivial. A simple last-write-wins with Task ID matching is sufficient. CRDTs and fancy sync protocols are for collaborative editing at scale; you don't need them.

#### 6. Recommendation

**Go with Option B (SQLite + Things 3 as cache)**, but keep it dead simple:

**Schema:**
```sql
CREATE TABLE commitments (
  id TEXT PRIMARY KEY,           -- AI-YYYYMMDD-HHMMSS
  title TEXT NOT NULL,
  direction TEXT NOT NULL,       -- 'mine' or 'theirs'
  person TEXT,
  source TEXT,                   -- email, Teams, meeting, etc.
  channel TEXT,                  -- where it was discussed
  due_date TEXT,                 -- ISO date or description
  status TEXT DEFAULT 'active',  -- active, completed, canceled
  things3_uuid TEXT,             -- Things 3 task UUID for sync
  created_at TEXT,
  completed_at TEXT,
  last_nudge TEXT,               -- for 'theirs' items
  notes TEXT
);
CREATE INDEX idx_status ON commitments(status);
CREATE INDEX idx_direction ON commitments(direction);
CREATE INDEX idx_person ON commitments(person);
```

**Sync strategy:**
1. **Agent creates commitment** -> writes to SQLite -> pushes to Things 3 via URL scheme -> stores returned UUID
2. **Agent completes commitment** -> marks complete in SQLite -> marks complete in Things 3
3. **User completes in Things 3** -> daily reconciliation script reads Things 3 DB -> marks complete in SQLite
4. **Markdown files** are generated from SQLite queries (for agent context windows)
5. **Things 3 task notes** store the Task ID so reconciliation can match items

**Why this over Option A**: 
- You already have rich metadata fields (last_nudge, channel, source) that don't map cleanly to Things 3's data model
- SQL queries like "show me everything overdue from Isabella" are one-liners vs parsing markdown
- The nudge agent, morning briefing, and EOD all need structured queries
- Adding new fields later (priority, category, sprint) is just an `ALTER TABLE`

**Why not more complex**:
- 27 active items don't need Postgres, vector search, or CRDTs
- Things 3 iCloud sync already handles multi-device
- Your agents already read/write markdown; SQLite is a trivial step up
- A single Python file can handle the full sync loop

---

### User Question 3 (Line 2222)
> We will want to differentiate between categories too (e.g., personal, work, church, etc.).
> How does the Claude Artifacts dashboard do it?
> Now that we are thinking from a DB perspective, is there other data that we're storing which should be stored differently/optimized?
> After meetings are over, maybe 15 minutes later, if Copilot was enabled, it will commonly have a summary, key decisions, if there was a recording, if there was a transcript, etc. I believe that workIQ would have this information. Do you look at that information?
> What if we did Option A but then had a SQL Lite table that has the extra information?

---

### Assistant Response 3: Comprehensive System Analysis (Line 2294)

#### 1. Categories (Personal, Work, Church, etc.)

Your dashboard already handles categories implicitly through its data, but it's not a first-class dimension. The briefing JSON has `channel` (outlook-work, teams, gmail, hmbl, outlook-personal) and the Tasks have `project` (Agent Skills, Operational, People & Growth, etc.), but there's no top-level `category` field like "work", "personal", "church".

Things 3 handles this well with **Areas** (Work, Personal, HMBL, Church) and your `add.sh` already supports `--area`. The gap is that the dashboard and briefing JSON don't carry that dimension forward. In a SQLite table, this would be a simple `category TEXT` column with an index, queryable across everything.

#### 2. How the Dashboard Does It

Your Mission Control dashboard renders everything from a single flat JSON blob. It has:
- **Stat cards** (meetings, inbox, focus, draftable)
- **Schedule** (timeline with live/next badges)
- **Inbox** (grouped by priority: high/medium, low collapsible)
- **Today's Focus** (carry-over + new tasks)
- **Commitments rail** (overdue, approaching, waiting-on-others)

It doesn't categorize by life context at all. Every item is mixed together, differentiated only by priority tint (red/yellow/green) and channel badge. There's no "Work tab" vs "Church tab" vs "Personal tab."

#### 3. Other Data That Could Be Optimized

Looking across your full data surface, you're storing several categories of structured data in flat markdown/JSON that would benefit from a database:

| Data | Current Storage | Problem | DB Benefit |
|------|----------------|---------|------------|
| **Action items (mine)** | `action-items.md` + `/memories/action-items.md` (duplicated!) | Two copies that can drift. Pipe-delimited fields. | Single source, relational queries |
| **Waiting on others** | `waiting-on-others.md` + `/memories/waiting-on-others.md` | Same duplication problem | Same |
| **Briefing items** | Per-day JSON with status tracking | Items carry forward by copy-paste between JSONs. Old items drift. | Stable item table spanning days |
| **Meeting data** | Embedded in daily JSON, lost after the day | No way to query "when did I last meet with Isabella?" | Meeting history table |
| **Contact interactions** | Scattered across journals, briefings, emails | No aggregated view of "last 5 interactions with [person]" | Interaction log table |
| **Priorities** | `priorities.md` rebuilt daily | No change history, no diff tracking | Could track priority changes over time |
| **Completion history** | In briefing JSON + Things 3 + action-items.md completed section | Three partial records | Single completion log |

The **duplication between `context/` files and `/memories/` files** is the most immediate pain point. Both `action-items.md` locations are being written by different routines.

#### 4. Meeting Summaries / Copilot Recaps

Your morning briefing prompt already calls `mcp_workiq_ask_work_iq` once per day to get overnight email/Teams activity and meeting data. But you're right that it's not pulling **post-meeting Copilot summaries** (recap, key decisions, action items, transcript, recording link).

WorkIQ should have access to this data (it can query your M365 Graph). The meeting recap data typically shows up 5-15 minutes after a meeting ends and includes:
- AI-generated summary
- Key decisions
- Action items (with assignees)
- Recording link
- Transcript availability

**Nobody is currently harvesting this**. Your EOD prompt makes a WorkIQ call but asks for general "work context," not specifically for meeting recaps. This is a missed data source. A post-meeting sweep (15-30 min after each meeting ends) could:
1. Pull the Copilot summary via WorkIQ
2. Extract action items (both the user's and others')
3. Auto-update `action-items.md` and `waiting-on-others.md`
4. Store the recap for future reference

#### 5. The Hybrid Idea: Things 3 as Source of Truth + SQLite for Metadata

This is actually the cleanest approach. Here's why it works better than pure Option B:

**Things 3 is already your source of truth for task state.** Your agents read the Things 3 SQLite database directly. Your dashboard syncs completions from Things 3. Users interact with Things 3 on mobile. Fighting this by making a separate SQLite the authority just creates a reconciliation problem.

Instead:

```
Things 3 (source of truth for task lifecycle)
  └── Title, status, project, area, when, deadline, tags, notes, checklist

assistant.db (SQLite, enrichment layer)
  └── Stores metadata Things 3 can't: direction, person, source channel,
      last_nudge, meeting_context, copilot_recap, interaction_history
  └── Keyed by things3_uuid or task_id (AI-YYYYMMDD-HHMMSS)
```

**Schema for `assistant.db`:**

```sql
-- Enrichment for Things 3 tasks (commitments, action items)
CREATE TABLE commitments (
  task_id TEXT PRIMARY KEY,        -- AI-YYYYMMDD-HHMMSS
  things3_uuid TEXT UNIQUE,        -- from Things 3 DB
  direction TEXT NOT NULL,         -- 'mine' or 'theirs'
  category TEXT,                   -- 'work', 'personal', 'church', 'hmbl'
  person TEXT,
  source TEXT,                     -- 'email', 'teams', 'meeting', 'imessage'
  channel TEXT,                    -- 'outlook-work', 'teams', etc.
  source_id TEXT,                  -- email ID or thread ID for deep linking
  created_at TEXT,
  completed_at TEXT,
  last_nudge TEXT,
  nudge_count INTEGER DEFAULT 0,
  notes TEXT
);

-- Meeting history (populated from briefings + Copilot recaps)
CREATE TABLE meetings (
  id TEXT PRIMARY KEY,             -- calendar event ID
  title TEXT,
  date TEXT,
  start_time TEXT,
  end_time TEXT,
  attendees TEXT,                  -- JSON array
  category TEXT,                   -- 'work', 'personal', 'church'
  copilot_summary TEXT,            -- from WorkIQ post-meeting
  key_decisions TEXT,              -- JSON array
  action_items TEXT,               -- JSON array (extracted by Copilot)
  recording_url TEXT,
  transcript_available INTEGER DEFAULT 0,
  attended INTEGER DEFAULT 0,
  created_at TEXT
);

-- Interaction log (when did I last engage with this person?)
CREATE TABLE interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person TEXT NOT NULL,
  type TEXT,                       -- 'email', 'teams', 'meeting', 'imessage', 'nudge'
  direction TEXT,                  -- 'inbound' or 'outbound'
  summary TEXT,
  source_id TEXT,                  -- email/thread ID
  category TEXT,                   -- 'work', 'personal', 'church'
  timestamp TEXT NOT NULL
);

CREATE INDEX idx_commitments_person ON commitments(person);
CREATE INDEX idx_commitments_direction ON commitments(direction);
CREATE INDEX idx_commitments_category ON commitments(category);
CREATE INDEX idx_meetings_date ON meetings(date);
CREATE INDEX idx_interactions_person ON interactions(person);
CREATE INDEX idx_interactions_timestamp ON interactions(timestamp);
```

**How the pieces fit:**

1. **Morning briefing** reads Things 3 (task state) + `assistant.db` (enrichment) instead of parsing markdown files
2. **Post-meeting sweep** (new automation, 15-30 min after meetings): WorkIQ call for Copilot recap -> insert into `meetings` table -> extract action items -> create Things 3 tasks + `commitments` rows
3. **Nudge agent** queries `SELECT * FROM commitments WHERE direction='theirs' AND completed_at IS NULL AND last_nudge < date('now', '-3 days')` instead of parsing markdown
4. **EOD** writes to `interactions` table as it processes the day
5. **Dashboard** can query the DB for richer views (by person, by category, meeting history)
6. **Markdown files become generated views** from the DB, not the source of truth (eliminates the duplication problem)
7. **Things 3 remains the mobile interface** - no change to the user experience

This gives you the best of both worlds: Things 3 for task lifecycle (what you interact with daily), SQLite for the metadata Things 3 can't store (who, direction, nudge history, meeting recaps, interaction timeline).

---

### User Question 4 (Line 2449)
> Let's add an automatic pull of Copilot meeting summaries 30 minutes after the scheduled end of every meeting. That will then be used to create more understanding of what transpired in meetings, and will make adjustments to our tasks as necessary. It should store everything useful about the meeting for context later (with reliance on potentially pulling the transcript later if deeper analysis is needed about the topic(s) discussed).
> I like your self-critique loop. Let's add it.
> With everything you've researched, what updates to our approach should we take?

---

### Assistant Response 4: Full System Optimization Proposals (Line 2506)

#### 1. Automatic Post-Meeting Recap Sweep

**Problem**: Meeting intelligence is currently either manual (`/meeting-recap`) or batched into EOD (where details are stale and Copilot recaps may have aged out). The pre-meeting side is automated (`meeting-sweep.sh` every 15 min), but the post-meeting side has no automation.

**Design**:

**New automation: `meeting-recap-sweep.sh`** runs every 15 min during work hours (same cadence as meeting-sweep). Each cycle:
1. Query calendar for meetings that **ended 25-35 min ago** (the sweet spot: Copilot recap has generated, but context is still fresh)
2. Check the meeting-brief ledger for events that have been briefed but not yet recapped (new status: `recapped`)
3. For each qualifying meeting, invoke the recap agent

**New prompt: `meeting-recap-auto.prompt.md`** stripped-down version of the existing `meeting-recap.prompt.md`, optimized for unattended execution:
1. Pull Copilot meeting recap via WorkIQ (primary), fall back to transcript summary
2. Write structured recap to `assistant/meetings/YYYY/MM/YYYY-MM-DD_meeting-slug.md` (same path convention as the manual prompt)
3. Auto-update `action-items.md` and `waiting-on-others.md` with the **unaccepted-offer filter** (don't create tasks for things the user volunteered but nobody accepted)
4. Create Things 3 tasks for confirmed action items
5. Store a `recap_summary` field in the ledger entry (2-3 sentence digest for EOD/weekly to reference without re-reading the full file)

**Ledger changes**: Add `recapped` to valid statuses in `meeting-brief-ledger.py`. Add a `recap` subcommand that mirrors `pending` but looks backward (meetings ended 25-35 min ago, status is `sent` or `refreshed` but not `recapped`).

**What EOD/weekly-review gain**: Instead of asking WorkIQ to reconstruct the day's meetings from scratch, they read the already-written recap files. Richer data, less token burn, faster execution.

**Manifest entry**: M-F every 15 min, 7 AM - 6 PM (same window as meeting-sweep). Initially `enabled: false` with enable instructions.

#### 2. Self-Critique Loop

**Problem**: Prompt tuning is currently reactive (the user runs `/briefing-tune` when something feels off). FenixAGI's `critique_and_revise_instructions()` pattern shows the value of proactive, automated reflection.

**Design**:

**New prompt: `self-critique.prompt.md`** runs as part of the weekly review (new Step 2.5, between "Synthesize the week" and "Set next week"). Also callable standalone via `/self-critique`.

**What it does**:
1. **Audit prompt performance**: Read the last 7 daily briefings, EOD journals, and any meeting recaps from the week. Score each routine on:
   - **Signal-to-noise**: Items that appeared but were never acted on (noise). Items the user had to manually surface (missed signal).
   - **Accuracy**: Tier classifications that were wrong in hindsight. Action items assigned to wrong owners. Due dates that were off.
   - **Efficiency**: Steps that consistently failed/timed out. Data sources that returned nothing useful.
   - **Completeness**: Things the user did that weren't captured. Meetings without recaps. Contacts not enriched.

2. **Diff against prior critique**: Read the last critique at `assistant/data/state/self-critique-log.md` (append-only file, one entry per week). Compare: did last week's recommendations get implemented? Did they help?

3. **Generate specific recommendations**: Not vague ("improve meeting prep"). Specific: "Add `@microsoft.com` filter to Teams noise list" or "Increase WorkIQ timeout from 10s to 15s for meeting queries" or "The 'Connects Signals' section was empty 4/5 days; consider removing from EOD template or adding more specific triggers."

4. **Categorize recommendations**:
   - **Auto-fix**: Things the agent can change right now (filter rules, timeout values, template tweaks). Present to the user for approval, then apply.
   - **Needs discussion**: Structural changes (new data sources, workflow changes, prompt architecture). Queue for `/briefing-tune`.
   - **Observation only**: Patterns worth tracking but not actionable yet.

5. **Write to log**: Append the week's critique to `assistant/data/state/self-critique-log.md` with date, scores, recommendations, and status of prior recommendations.

**Weekly review integration**: After Step 2 (Synthesize the week), run self-critique. Include the top 2-3 findings in the weekly summary under a new `## System Health` section. Only surface auto-fix items for approval during the review itself.

#### 3. Approach Updates (from research)

Based on everything from Parth, Dex Horthy, Brynjolfsson, and Woods:

| Update | What | Why |
|---|---|---|
| **Dense context pruning** | Add a quarterly pass to memory files that removes stale entries. Self-critique flags candidates weekly; quarterly review prunes. | Dex Horthy: "Smaller and denser context often wins." Memory files grow monotonically right now. |
| **Recap-first EOD** | EOD reads recap files instead of re-querying WorkIQ for meeting data | Eliminates redundant API calls, gets richer data, faster execution. Recap sweep produces the artifacts. |
| **Input validation on automated workflows** | Add pre-flight checks to `meeting-recap-sweep.sh` and `meeting-sweep.sh`: verify WorkIQ is reachable, verify Copilot CLI is authenticated, verify ledger isn't corrupt, before invoking the agent. | OpenAI Agents SDK guardrails pattern. Currently these scripts just fail and log errors. |
| **Narrative for AI practices presentation** | Use Brynjolfsson's Productivity J-Curve + Turing Trap + Woods' AI Empowerment Flywheel as the framing for your April 30 presentation. Your system is a live case study. | You're living the "intangible investment" phase. The research gives you the academic backing. |
| **Deprecate stale briefing-tune interviews** | Self-critique loop subsumes most of what `/briefing-tune` does reactively. Keep `/briefing-tune` for ad-hoc issues, but the weekly self-critique becomes the primary tuning mechanism. | FenixAGI pattern: automated reflection is more consistent than on-demand interviews. |

**Not recommending** (considered but rejected):
- Migrating to OpenAI Agents SDK: Your prompt-based system is more flexible and runtime-agnostic. The SDK would lock you into OpenAI's tooling.
- Multi-agent handoff infrastructure: You already have this via `.prompt.md` agents + Copilot CLI routing. No need to add complexity.
- FenixAGI-style state serialization: Your memory files + JSON ledgers are already more mature.

**Implementation order** (if approved):
1. Ledger update (add recap tracking) - small, foundational
2. `meeting-recap-auto.prompt.md` - the recap agent
3. `meeting-recap-sweep.sh` - the automation shell script
4. `self-critique.prompt.md` - the critique loop
5. Weekly review integration - wire self-critique into the weekly flow
6. Manifest updates - register both new automations
7. Input validation upgrades to existing sweep scripts

---

### User Follow-up (Line 2516)
> For the query calendar, make sure that you don't have any gaps in time (e.g., every 15 min scan for meetings that ended today which we haven't yet been able to retrieve a summary, but know that beyond an hour after the meeting ends the summary will either have been saved or isn't going to be saved) also check the chat of the meeting to see if you can gain any insights from there.
> I like the rest of your recommendations. Let's queue them up, but I want to discuss all of the other ideas you posed today (e.g., how we store the information).

---

## Summary of All Proposals

### Storage Architecture (The "How We Store Information" Thread)

| # | Proposal | Status |
|---|----------|--------|
| 1 | **Hybrid architecture: Things 3 as task lifecycle source of truth + `assistant.db` SQLite as enrichment layer** | Proposed, user expressed interest ("What if we did Option A but then had a SQLite table that has the extra information?"), agent endorsed |
| 2 | **Three SQLite tables**: `commitments` (task enrichment), `meetings` (Copilot recaps + history), `interactions` (person engagement log) | Schema designed, not yet built |
| 3 | **Markdown files become generated views** from the DB, not the source of truth | Proposed as part of hybrid architecture |
| 4 | **Eliminate duplication** between `context/` and `/memories/` files | Identified as most immediate pain point |
| 5 | **Category as first-class dimension** across all data (`work`, `personal`, `church`, `hmbl`) | Proposed as column in all three tables |

### System Optimization (The "What Should We Improve" Thread)

| # | Proposal | Status |
|---|----------|--------|
| 6 | **Automatic post-meeting recap sweep** (every 15 min, harvest Copilot summaries) | Designed, user approved with modification (no time gaps, check meeting chat) |
| 7 | **Self-critique loop** (weekly automated prompt performance audit) | Designed, user approved |
| 8 | **Dense context pruning** (quarterly memory file cleanup) | Proposed |
| 9 | **Recap-first EOD** (EOD reads recap files instead of re-querying WorkIQ) | Proposed |
| 10 | **Input validation on automated workflows** (pre-flight checks) | Proposed |
| 11 | **Deprecate reactive briefing-tune** in favor of weekly self-critique | Proposed |

### User's Pending Decision
User said: "I want to discuss all of the other ideas you posed today (e.g., how we store the information)" - indicating the storage architecture discussion was not yet concluded.
