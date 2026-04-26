#!/bin/zsh
# Rolling Meeting Brief Sweep
# Triggered by launchd every 15 minutes during work hours
# Identifies high-stakes upcoming meetings (next 60 min) that have not yet been
# briefed and runs the /meeting-brief Copilot agent for each. Stays cheap by
# delegating dedupe + filtering to atlas-db.py.
#
# Per-event brief content is written by the agent. This script's job is:
#   1. Pull upcoming events from the calendar
#   2. Filter via the ledger (skip already-briefed, skip routine)
#   3. Invoke the meeting-brief agent per event
#   4. Notify on completion / failure

set -euo pipefail

DATE=$(date +%Y-%m-%d)
ASSISTANT_DIR="$HOME/projects/personal/assistant"
AUTOMATION_DIR="$ASSISTANT_DIR/automation"
SCRIPTS_DIR="$ASSISTANT_DIR/scripts"
LOG_DIR="$AUTOMATION_DIR/logs"
LOG_FILE="$LOG_DIR/meeting-sweep-${DATE}.log"
ATLAS="$SCRIPTS_DIR/atlas-db.py"

mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== Meeting Sweep: $(date '+%Y-%m-%d %H:%M:%S') ==="

# Time-of-day guard: only run between 7:00 AM and 6:00 PM weekdays.
CURRENT_HOUR=$(date +%H)
DOW=$(date +%u)
if [[ $DOW -ge 6 ]]; then
  echo "Skipping: weekend"
  exit 0
fi
if [[ $CURRENT_HOUR -lt 7 || $CURRENT_HOUR -ge 18 ]]; then
  echo "Skipping: outside work hours (current: $CURRENT_HOUR)"
  exit 0
fi

if ! command -v copilot &>/dev/null; then
  echo "ERROR: copilot CLI not found in PATH"
  exit 1
fi

# --- Input validation (guardrails) ---

# Check atlas-db script exists
if [[ ! -f "$ATLAS" ]]; then
  echo "ERROR: atlas-db script not found at $ATLAS"
  exit 1
fi

# Check assistant.db isn't corrupt (quick integrity test)
DB_FILE="$ASSISTANT_DIR/data/state/assistant.db"
if [[ -f "$DB_FILE" ]]; then
  if ! python3 -c "import sqlite3; c=sqlite3.connect('$DB_FILE'); c.execute('PRAGMA integrity_check')" 2>/dev/null; then
    echo "WARNING: assistant.db may be corrupt. Backing up."
    cp "$DB_FILE" "${DB_FILE}.corrupt.$(date +%s)"
  fi
fi

# Lookahead window for meetings worth pre-briefing (minutes from now).
LOOKAHEAD_MIN="${MEETING_SWEEP_LOOKAHEAD:-60}"

cd "$ASSISTANT_DIR"

# Step 1: Fetch upcoming events as JSON via the calendar agent.
# We delegate to a minimal copilot call that ONLY emits JSON to stdout.
# This keeps the sweep deterministic; the agent handles provider auth.
EVENTS_JSON=$(perl -e 'alarm 60; exec @ARGV' -- copilot \
  --agent=morning-briefing \
  -p "List my calendar events between now and ${LOOKAHEAD_MIN} minutes from now. Output ONLY a JSON array (no prose, no markdown fences) where each element has: event_id, title, start (ISO 8601 with timezone), end (ISO 8601), attendees (array of {name,email}), and external_count (count of attendees whose email domain is not microsoft.com)." \
  --allow-tool='workiq' \
  --allow-tool='outlook' \
  2>>"$LOG_FILE" | python3 -c "
import sys, json, re
raw = sys.stdin.read()
# Strip markdown fences if the agent ignored instructions.
m = re.search(r'\[.*\]', raw, re.DOTALL)
if not m:
    sys.exit(0)
try:
    data = json.loads(m.group(0))
    print(json.dumps(data))
except json.JSONDecodeError:
    sys.exit(0)
")

if [[ -z "$EVENTS_JSON" ]]; then
  echo "No events returned from calendar (or parse failed). Exiting."
  exit 0
fi

# Step 2: Filter via the ledger.
PENDING=$(echo "$EVENTS_JSON" | python3 "$ATLAS" meeting pending --within-min "$LOOKAHEAD_MIN")
PENDING_COUNT=$(echo "$PENDING" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")

echo "Pending high-stakes events to brief: $PENDING_COUNT"

if [[ "$PENDING_COUNT" -eq 0 ]]; then
  exit 0
fi

# Step 3: Brief each event.
echo "$PENDING" | python3 -c "
import sys, json
for ev in json.load(sys.stdin):
    print('\t'.join([ev['event_id'], ev['start'], ev['title']]))
" | while IFS=$'\t' read -r EVENT_ID START TITLE; do
  echo ""
  echo "--- Briefing: $TITLE ($START) ---"

  if perl -e 'alarm 240; exec @ARGV' -- copilot \
    --agent=meeting-brief \
    -p "Generate a meeting brief for event_id=${EVENT_ID}. Title is \"${TITLE}\", starts at ${START}. Use atlas-db.py meeting add+mark workflow. Write the per-meeting file and notify on completion." \
    --allow-tool='shell' \
    --allow-tool='write' \
    --allow-tool='workiq' \
    --allow-tool='outlook' \
    --allow-tool='memory' \
    --deny-tool='shell(rm)' \
    --deny-tool='shell(git push)'; then
    SHORT_TITLE=$(echo "$TITLE" | cut -c1-40)
    osascript -e "display notification \"Brief ready: ${SHORT_TITLE}\" with title \"Atlas\" sound name \"Glass\"" || true
  else
    echo "ERROR: brief generation failed for $TITLE"
    python3 "$ATLAS" meeting mark "$EVENT_ID" --status failed || true
    osascript -e "display notification \"Brief FAILED: ${TITLE}\" with title \"Atlas\" sound name \"Sosumi\"" || true
  fi
done

echo "=== Finished: $(date '+%H:%M:%S') ==="
