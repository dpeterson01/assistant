# Dashboard Design Research Report
## Personal Productivity & Time Management Dashboard Patterns

**Date**: 2026-04-24  
**Purpose**: Inform restructuring of the daily briefing/dashboard for a PM leader with email, Teams, tasks, accountability, and calendar integration.

---

## 1. Framework Consensus: What the Major Productivity Frameworks Agree On

### 1.1 The Inbox Must Be Separate from the Work Queue

Every major framework enforces a hard boundary between *capture* and *action*:

- **GTD** (David Allen): The Inbox is a collection point only. Items must be *clarified* and *organized* into separate lists (Next Actions, Waiting For, Someday/Maybe, Projects, Reference) before they become work. "Your head's a crappy office." The entire system hinges on processing the inbox *into* other containers.
  - Source: [Todoist GTD Guide](https://todoist.com/productivity-methods/getting-things-done)

- **Things 3** (Cultured Code): "Each and every thing that you want to accomplish needs to end up in one place, and that place is the Inbox. It's fine if you haven't yet come up with a plan for exactly how or when you'll do these new to-dos. What's crucial is immediately getting them off your mind and into the Inbox to revisit later."
  - Source: [Things Getting Productive Guide](https://culturedcode.com/things/guide/)

- **Akiflow Method**: Explicitly calls for a "Universal Inbox" to collect all tasks, ideas, and commitments in one place, then a separate "Process/Prioritize" phase to transform captured inputs into actionable items. Further: "Separating Planning from Doing: A well-designed productivity system distinguishes between action and motion. By separating your task inbox (planning) from your today list (action), you avoid the temptation to constantly switch between deciding what to do and actually doing it."
  - Source: [Akiflow Method](https://akiflow.com/method)

- **Sunsama**: "Your inbox's only job is to receive and send messages. That's it. It's not a task manager, a project planner, or a file cabinet. When you let your inbox dictate your priorities, you're letting other people's agendas run your day." Their core workflow is triage->plan->focus.
  - Source: [Sunsama Email Overload Guide](https://sunsama.com/blog/how-to-manage-email-overload)

**Consensus**: Inbox and tasks MUST be separate. The inbox is a staging area. Tasks are committed work. Mixing them creates anxiety and reactive behavior.

### 1.2 "Waiting For" Is a First-Class Concept

- **GTD**: Explicitly defines "Waiting For" as a core list. Items are tagged with `@waiting_for` and kept organized inside their related projects. The weekly review includes checking all Waiting For items. GTD also has "Agendas" as a separate concept for things to discuss with specific people.
  - Source: [Todoist GTD Guide](https://todoist.com/productivity-methods/getting-things-done) - "These are items that have been delegated or are awaiting action by someone else."

- **Linear Method**: "Keep a manageable backlog. Important ones will resurface, low priority ones will never get fixed." Their triage model (Triage -> Active -> Backlog) inherently separates "blocked/waiting" states from active work.
  - Source: [Linear Method Introduction](https://linear.app/method/introduction)

- **Todoist's GTD Implementation**: Recommends a dedicated filter: `@waiting_for` to see all waiting items across all projects.

**Consensus**: Waiting-on-others is not just metadata on a task. It's a distinct *state* that should be surfaceable as its own view. Most frameworks handle it as a label/tag that creates a cross-cutting view, not a separate container.

### 1.3 Urgency and Importance Are Orthogonal Dimensions

- **Eisenhower Matrix**: The "Mere-Urgency Effect" is a documented psychological bias. "Our attention is drawn to time-sensitive tasks over tasks that are less urgent, even when the less urgent task offers greater rewards." Research from the Journal of Consumer Research confirmed this across five experiments. The effect is *reversible* when people are prompted to consider long-term consequences.
  - Source: [Todoist Eisenhower Guide](https://todoist.com/productivity-methods/eisenhower-matrix)

- **Covey/Eisenhower Q2**: The "Quadrant of Quality" is Not Urgent & Important. This is where deep work, planning, relationship building, and skill development live. Spending too much time in Q1 (Urgent & Important) leads to burnout. Q3 (Urgent & Not Important) is the trap of busywork driven by others' priorities.

**Implication for our dashboard**: Deadlines and urgency markers should be *visible* but should not automatically elevate items above important-but-not-urgent work. The dashboard should help the user stay in Q2, not get sucked into Q1/Q3.

### 1.4 The "Today" View Is Sacred

Every product and framework converges on a curated daily view:

- **Things 3**: Today + This Evening. Calendar events display alongside to-dos. "When you take a bit of time to organize your Today list, it'll no longer seem like each day is merely something that happens to you."
- **Sunsama**: The entire product is built around a daily plan. "Start each day with clarity. Plan your day with intention."
- **Todoist**: Today and Upcoming are the primary engagement views.
- **Akiflow**: Time blocking is the core engagement pattern. "Plan" phase creates a visual roadmap of your day.
- **Amazing Marvin**: Day Planning feature with capacity estimator. "Schedule tasks for each day and get instant feedback on whether your plan is realistic or over capacity."
- **Reclaim.ai**: Auto-schedules tasks onto calendar to defend focus time.

**Consensus**: The daily view should be a *curated, intentional plan* for the day, not a dump of everything. It should integrate calendar events with tasks.

### 1.5 Time Horizons Create Natural Sections

All frameworks define temporal buckets:

| Framework | Now | Soon | Later | Maybe |
|-----------|-----|------|-------|-------|
| **GTD** | Next Actions | Calendar/Scheduled | Someday/Maybe | Someday/Maybe |
| **Things 3** | Today | Upcoming | Anytime | Someday |
| **Todoist** | Today | Upcoming | (in projects) | (no explicit) |
| **Sunsama** | Today's Plan | This Week | (backlog in integrations) | N/A |
| **Akiflow** | Today (time blocks) | This Week | Inbox/Backlog | N/A |
| **PARA** | Projects (active) | Projects (active) | Resources | Archives |

**Consensus**: 3-4 temporal horizons is the sweet spot. More than that creates decision paralysis.

### 1.6 Regular Review Is Non-Negotiable

- **GTD**: The Weekly Review is "a critical factor for success." Review all lists, update projects, check Waiting For items, process inbox to zero.
- **Akiflow**: Daily Shutdown ritual reviews progress, consolidates achievements, sets up tomorrow. "Today's Review" + "Tomorrow's Review."
- **Sunsama**: Built-in daily shutdown. "Automatically track your daily wins, record your progress, and finish the day feeling calm and accomplished."
- **Linear**: "Work in n-week cycles. Cycles create a healthy routine."

**Consensus**: The system must include structured review moments (daily + weekly minimum).

---

## 2. Product Patterns: What the Best Products Actually Do

### 2.1 Structural Patterns Across Products

| Product | Inbox | Today | Upcoming/Calendar | Projects | Waiting/Delegated | Someday |
|---------|-------|-------|-------------------|----------|-------------------|---------|
| **Things 3** | Dedicated Inbox | Today + This Evening | Upcoming (timeline) | Projects with Headings | Via tags | Someday list |
| **Todoist** | Inbox (default) | Today view | Upcoming view | Projects + Sub-projects | @waiting_for label + filter | No dedicated view |
| **Sunsama** | Pulls from integrations | Daily plan (primary) | Weekly view | Via integrations | Not explicit | Not explicit |
| **Akiflow** | Universal Inbox | Time-blocked day | Calendar view | Projects + Folders | Not explicit | Not explicit |
| **Amazing Marvin** | Master list | Day view + Spotlight | Calendar | Categories/Projects | Not explicit | Custom strategies |
| **Linear** | Triage queue | Active cycle | Backlog | Projects + Initiatives | Blocked state | Backlog |
| **Microsoft To Do** | Tasks list | My Day | Planned | Lists | Not explicit | Not explicit |
| **Superhuman** | Split Inbox | Inbox sections | Reminders/Snooze | Labels | Snooze-based | N/A |
| **Reclaim.ai** | Task list | Calendar (auto-scheduled) | Calendar | Projects | Not explicit | Not explicit |

### 2.2 How Products Handle the "Same Item in Multiple Places" Problem

This is the central design tension. Products solve it in three ways:

**A. Tags/Labels Create Cross-Cutting Views (GTD/Todoist/Things 3)**
- Items live in ONE container (a project).
- Tags/labels add dimensions (@waiting_for, @next, @urgent, @context).
- Saved filters/views surface items across containers by tag.
- **Pro**: Single source of truth, no duplication.
- **Con**: Requires discipline to tag consistently.

**B. Temporal Scheduling Creates Focused Views (Sunsama/Akiflow/Things 3)**
- Items live in projects but are *scheduled* for specific days.
- The "Today" view pulls from all projects.
- Calendar integration makes the daily view authoritative.
- **Pro**: Simple mental model. Clear daily focus.
- **Con**: Unscheduled items become invisible.

**C. Workflow States Replace Containers (Linear)**
- Items move through states: Triage -> Todo -> In Progress -> Done.
- Views are state-based, not container-based.
- **Pro**: Natural for work that flows through stages.
- **Con**: Less intuitive for personal task management.

**Our case fits pattern A + B**: Items live in a canonical location (action-items.md, waiting-on-others.md) and the daily briefing *pulls* relevant items into a curated daily view based on date, urgency, and staleness.

### 2.3 How Products Handle Accountability/Commitments

No mainstream product has a first-class "things I owe others" view. This is a gap in the market. The closest patterns:

- **GTD/Todoist**: The "Agendas" project with sub-projects per person. "Create a new sub-project underneath Agendas for each person you need to touch base with on a regular basis."
- **GTD/Todoist**: "Waiting For" is the *inverse* concept (things others owe you), using the `@waiting_for` tag.
- **GTD/Todoist**: "assigned by: me" query shows all delegated tasks.
- **Linear**: Every issue has an owner. Accountability is structural, not a view.
- **Sunsama**: No explicit accountability tracking. Philosophy is "your priorities, not others' agendas."

**Key insight**: Accountability (what I owe others) and Waiting For (what others owe me) are the *same relationship seen from two directions*. They should be parallel constructs with symmetric surfacing.

### 2.4 The Sunsama "Triage -> Plan -> Focus" Loop

Sunsama's core workflow is the most relevant to our use case:

1. **Morning planning ritual**: Quick triage of inboxes (email, integrations). Identify what needs action.
2. **Drag into daily plan**: Move actionable items from inbox/integrations into the day's task list.
3. **Time block**: Assign time estimates and block on calendar.
4. **Focus mode**: Work through the plan. Pull in new tasks as they arrive.
5. **Daily shutdown**: Review progress, celebrate wins, set up tomorrow.

This maps almost exactly to our morning briefing -> daily work -> end-of-day flow.

### 2.5 The Akiflow "Separating Planning from Doing" Principle

From Akiflow's method page: "Keeping these two phases separate is essential for maintaining clarity and focus. By separating your task inbox (planning) from your today list (action), you avoid the temptation to constantly switch between deciding what to do and actually doing it. This clear delineation reduces decision fatigue and empowers you to approach your tasks with a clear mind and unwavering focus."

**This is the strongest argument for keeping inbox/triage separate from the active task list in our dashboard.**

---

## 3. Anti-patterns: What Approaches Are Known to Fail

### 3.1 The Infinite Flat List

Showing all tasks in one undifferentiated list. Reclaim.ai's data: "ICs waste an average of 24.5% of their standard 40-hour workweek on unproductive task work like answering emails, hopping around Slack, or browsing their task lists." Browsing an unsorted list is itself a productivity drain.
- Source: [Reclaim Task Management Trends](https://reclaim.ai/blog/task-management-trends-report)

### 3.2 Chasing Inbox Zero as the Goal

Sunsama explicitly warns: "Chasing an empty inbox can ironically create more stress. It quickly becomes just another number to obsess over, turning email management into your main job instead of your actual job. The goal isn't a literally empty inbox. It's a clear mind."
- Source: [Sunsama Email Guide](https://sunsama.com/blog/how-to-manage-email-overload)

The correct goal is "inbox processed" (every item has been seen and a decision made), not "inbox empty."

### 3.3 Overloading the Daily Plan

Amazing Marvin addresses this with capacity estimation. Reclaim's data shows "Only 53.5% of planned tasks get completed by ICs every week." Planning more than you can do creates a daily sense of failure.
- Sources: [Reclaim Task Management Trends](https://reclaim.ai/blog/task-management-trends-report), [Amazing Marvin](https://amazingmarvin.com/)

### 3.4 Too Many Views/Sections

Linear's principle: "Simple first, then powerful." Their method page warns against overcomplication. Cognitive load research (Miller's Law) suggests 7 plus/minus 2 chunks is the working memory limit.

Amazing Marvin solves this by making features opt-in: "Enable only the features you need." 300+ customizable settings, but you start with minimal UI.

### 3.5 Treating the Inbox as a To-Do List

Sunsama: "When you let your inbox dictate your priorities, you're letting other people's agendas run your day. An urgent request from a colleague doesn't automatically make it your most important task."

Akiflow: "Motion is the planning and preparation phase, while action is the actual execution of tasks."

### 3.6 Not Tracking Unproductive Time

Reclaim's data: "ICs average 1.96 hours of unproductive task work every day (answering emails, hopping around Slack, browsing task lists), or 9.8 hours/week." Without visibility into where time goes, improvement is impossible.

### 3.7 Ignoring the "Mere-Urgency Effect"

From the Eisenhower research: Urgent items with lower payoffs consistently get prioritized over important items without deadlines. The fix is to keep long-term importance visible alongside urgency.
- Source: [Todoist Eisenhower Guide](https://todoist.com/productivity-methods/eisenhower-matrix), citing Journal of Consumer Research

---

## 4. Recommendations for Our Case

Given: A daily briefing dashboard for a PM leader (the user) who manages email (Exchange + personal Outlook + Gmail), Teams messages, iMessages, a Things 3 task list, accountability commitments, and waiting-on-others tracking.

### 4.1 Recommended Section Structure (5-6 sections)

Based on framework consensus and product patterns, the dashboard should have these sections:

| # | Section | Purpose | Maps to |
|---|---------|---------|---------|
| 1 | **Calendar Horizon** | Today's meetings + tomorrow preview | Things 3 Today, Sunsama calendar |
| 2 | **Inbox / Triage** | New items needing decisions (new emails, messages, notifications) | GTD Inbox, Akiflow Universal Inbox |
| 3 | **Today's Focus** | Curated action items for today, with urgency signals | Things 3 Today, Sunsama daily plan, Eisenhower Q1+Q2 |
| 4 | **Accountability** | Things I owe others, sorted by staleness/deadline | GTD Next Actions + Agendas |
| 5 | **Waiting On Others** | Things others owe me, sorted by staleness | GTD @waiting_for |
| 6 | **Upcoming / Horizon** | Future-dated items, approaching deadlines, this-week preview | Things 3 Upcoming, Todoist Upcoming |

**Why 5-6 sections**: Miller's Law (7+/-2 chunks), plus product patterns show 4-6 primary views is standard. Things 3 has 6 temporal views (Inbox, Today, Upcoming, Anytime, Someday, Logbook). Todoist has 4 (Inbox, Today, Upcoming, Filters). Sunsama effectively has 3 (Today, Week, Integrations). 5-6 is the sweet spot between comprehensive and overwhelming.

### 4.2 Inbox Should Be Separate from Tasks

**Strong recommendation**: Keep inbox/triage as its own section, distinct from Today's Focus.

Evidence:
- GTD's entire 5-step workflow separates Capture from Organize from Engage
- Akiflow explicitly calls out "separating planning from doing" as essential
- Sunsama's "inbox is a delivery service, not a to-do list" principle
- Things 3's Inbox is a dedicated, separate view from Today

**Implementation**: The morning briefing presents new inbound items (emails, Teams messages, notifications) in a triage section. the user processes them into either: (a) Today's Focus, (b) Action Items for later, (c) Waiting On Others, or (d) dismissed. The triage section should be empty (or nearly so) after the morning briefing.

### 4.3 Accountability Should Be a Separate View, Not Just Metadata

**Moderate recommendation**: Surface accountability as its own section, but items should also appear in Today's Focus when due.

Evidence:
- No mainstream product does this well (market gap)
- GTD's "Agendas" concept is the closest: per-person lists of things to discuss
- The "who am I blocking?" question is distinct from "what should I work on?"
- PM leaders are measured on responsiveness and follow-through, making accountability a first-class concern

**Implementation**: Accountability items have: person owed, source, date created, deadline. They appear in their own section sorted by staleness (oldest first, overdue highlighted). Items due today also appear in Today's Focus with an accountability badge.

### 4.4 Waiting On Others Should Mirror Accountability

**Strong recommendation**: Waiting On Others is the symmetric inverse of Accountability. Same structure: person, what's owed, date requested, expected date.

Evidence:
- GTD treats @waiting_for as a first-class list
- Weekly review includes checking all Waiting For items
- For a PM leader, blocked work is as important to surface as owned work

### 4.5 Urgency Should Be Surfaced via Visual Signals, Not Separate Sections

**Strong recommendation**: Don't create separate "urgent" and "non-urgent" sections. Instead, use visual indicators within existing sections.

Evidence:
- The Mere-Urgency Effect research shows that separating by urgency causes people to neglect important-but-not-urgent work
- Eisenhower Matrix uses color coding (P1=Red, P2=Orange, P3=Blue, P4=None)
- Things 3 uses deadline badges, not urgency sections
- The fix for urgency bias is to "keep the long-term importance of non-urgent tasks in view"

**Implementation**: 
- Overdue items get a red/warning indicator wherever they appear
- Items due today get a subtle date badge
- Items aging (>3 days without action) get a staleness indicator
- But all items remain in their logical section (Accountability, Today's Focus, etc.)

### 4.6 The Triage Flow Should Be: Process Inbox -> Populate Today

**Strong recommendation**: Morning briefing should follow the Sunsama/Akiflow pattern.

1. Present calendar first (fixed commitments frame the day)
2. Show inbox/triage items (new since last session)
3. For each: dismiss, defer, add to today, add to action items, add to waiting-on
4. Show today's focus (curated from step 3 + pre-scheduled items)
5. Show accountability items (with staleness signals)
6. Show waiting-on items (with staleness signals)
7. Show upcoming horizon (next 2-3 days)

### 4.7 The Daily Review / End-of-Day Should Close the Loop

Following Akiflow's "Daily Shutdown" and Sunsama's end-of-day pattern:
1. Review what was planned vs. what was accomplished
2. Update accountability items (completed? still pending?)
3. Check waiting-on items (any movement?)
4. Preview tomorrow's calendar
5. Surface any items that fell through the cracks

---

## 5. Key Citations and Sources

### Frameworks
- **GTD (Getting Things Done)**: [Todoist GTD Guide](https://todoist.com/productivity-methods/getting-things-done) - Comprehensive walkthrough of Capture, Clarify, Organize, Engage, Review. Key lists: Inbox, Next Actions, Waiting For, Someday/Maybe, Projects, Reference, Agendas.
- **PARA Method**: [Forte Labs PARA](https://fortelabs.com/blog/para/) - "Organize by actionability, not by subject." Four categories: Projects, Areas, Resources, Archives. Key insight: "If your organizational system is as complex as your life, then the demands of maintaining it will end up robbing you of the time and energy you need to live that life."
- **Eisenhower Matrix**: [Todoist Eisenhower Guide](https://todoist.com/productivity-methods/eisenhower-matrix) - Urgent/Important quadrants. Key research: "Mere-Urgency Effect" from Journal of Consumer Research shows we prioritize deadline-driven tasks over higher-value tasks. Effect is reversible when consequences are made visible.

### Products
- **Things 3**: [Getting Productive Guide](https://culturedcode.com/things/guide/) - Inbox, Today/This Evening, Upcoming, Anytime, Someday, Projects, Areas. Key quote: "When you take a bit of time to organize your Today list, it'll no longer seem like each day is merely something that happens to you."
- **Things 3 Features**: [Features Page](https://culturedcode.com/things/features/) - Calendar integration in Today view, This Evening sub-section, Upcoming timeline, Headings for project structure.
- **Sunsama**: [Homepage](https://sunsama.com/) - "Start Calm. Stay Focused. End Confident." Core flow: plan -> focus -> reflect. Integrates with Gmail, Outlook, Slack, Teams, Jira, Linear, Asana, Todoist, Notion. Named Best Scheduling Tool by Wirecutter.
- **Sunsama Email Philosophy**: [Email Overload Guide](https://sunsama.com/blog/how-to-manage-email-overload) - "Your inbox is a delivery service, not a to-do list." Four Ds: Delete, Delegate, Do (< 2 min), Defer (pull into task manager). "Inbox Managed, not Inbox Empty."
- **Akiflow Method**: [Method Page](https://akiflow.com/method) - Capture, Process/Prioritize, Plan (time blocking), Execute, Review. Key insight: "Separating your task inbox (planning) from your today list (action) reduces decision fatigue."
- **Amazing Marvin**: [Homepage](https://amazingmarvin.com/) - 300+ customizable settings. Strategy system with opt-in features. Day Planning with capacity estimator. Super Focus Mode (one task at a time). Procrastination Wizard.
- **Linear Method**: [Method Introduction](https://linear.app/method/introduction) - "Say no to busy work. Your tools should not make you the designer and maintainer of them." "Keep a manageable backlog." "Scope issues to be as small as possible."
- **Reclaim.ai Task Management Report**: [Report](https://reclaim.ai/blog/task-management-trends-report) - 2,000+ professionals surveyed. Key stats: Only 53.5% of planned tasks completed weekly. ICs interrupted 31.6 times/day. 24.5% of workweek wasted on unproductive task browsing. Managers spend 5 hrs/week just prioritizing. 78.7% experience stress from increasing tasks + lack of time. Reclaim users report 41.1% improvement in prioritization.

### Research
- **Mere-Urgency Effect**: Journal of Consumer Research study showing deadline-driven tasks are chosen over higher-value tasks. Effect stronger in self-described "busy" people. Reversed when long-term consequences are made visible.
- **Context Switching Cost**: Research cited by Sunsama: "It can take over 23 minutes to fully get back on track after an interruption."
- **Miller's Law**: Working memory limit of 7+/-2 chunks, applied to dashboard section count.
- **Reclaim Productivity Stats**: ICs average only 2.24 hours of actual productive task work per day. Managers average 1.83 hours.

---

## 6. Summary Table: Design Questions Answered

| Question | Evidence-Based Answer |
|----------|---------------------|
| Should inbox and tasks be in the same list? | **No.** Universal consensus across GTD, Akiflow, Sunsama, Things 3. Inbox is for capture/triage. Tasks are committed work. |
| How should "things I owe others" be surfaced? | **Separate view + badges in Today.** No product does this well (market gap). GTD's "Agendas" is closest. Our accountability list is a genuine differentiator. |
| How should "waiting on others" be tracked? | **Separate view, parallel to accountability.** GTD treats it as first-class. Weekly review should check all items. |
| Ideal number of sections before cognitive overload? | **5-6 sections.** Miller's Law (7+/-2). Products range from 3 (Sunsama) to 6 (Things 3). |
| How to handle "same item in multiple places"? | **Tags/temporal scheduling hybrid.** Items live in one canonical location. Views pull items based on date, state, and urgency. |
| Recommended triage flow? | **Process inbox into tasks.** Sunsama's triage->plan->focus loop. Akiflow's separate planning from doing. |
| How should deadlines/urgency be surfaced? | **Visual indicators within sections, not separate sections.** Mere-Urgency Effect research shows separation causes neglect of important work. Use color/badges for overdue, due-today, and aging items. |
