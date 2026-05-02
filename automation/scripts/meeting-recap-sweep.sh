#!/bin/zsh
# Rolling Meeting Recap Sweep
# Triggered by launchd every 15 minutes during work hours.
# Identifies meetings that ended today (within the last 60 minutes) which
# haven't been recapped yet, and runs the meeting-recap-auto agent for each.
#
# Timing strategy: scans every 15 min for ALL unrecapped meetings that ended
# today, up to 60 min after end time. This means:
#   - A meeting ending at 10:00 gets checked at 10:15, 10:30, 10:45, 11:00
#   - After 11:00 (60 min past), it falls out of the window
#   - First attempt (~15 min post) may not have Copilot recap yet — that's OK,
#     the agent captures what's available (chat, attendees, basic info)
#   - Later attempts won't retry if already recapped (ledger dedupes)
#
# The 60-min cap ensures we don't burn tokens on meetings where Copilot
# recap isn't coming. the user can always run /meeting-recap manually for those.

set -euo pipefail

DATE=$(date +%Y-%m-%d)
ASSISTANT_DIR="$HOME/projects/personal/assistant"
AUTOMATION_DIR="$ASSISTANT_DIR/automation"
SCRIPTS_DIR="$ASSISTANT_DIR/scripts"
LOG_DIR="$AUTOMATION_DIR/logs"
LOG_FILE="$LOG_DIR/meeting-recap-sweep-${DATE}.log"
ATLAS="$SCRIPTS_DIR/atlas-db.py"

mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== Meeting Recap Sweep: $(date '+%Y-%m-%d %H:%M:%S') ==="

# Time-of-day guard: only run between 7:00 AM and 7:00 PM weekdays.
# Extended to 7 PM (vs 6 PM for pre-briefs) because meetings run late.
CURRENT_HOUR=$(date +%H)
DOW=$(date +%u)
if [[ $DOW -ge 6 ]]; then
  echo "Skipping: weekend"
  exit 0
fi
if [[ $CURRENT_HOUR -lt 7 || $CURRENT_HOUR -ge 19 ]]; then
  echo "Skipping: outside work hours (current: $CURRENT_HOUR)"
  exit 0
fi

# --- Input validation (guardrails) ---

# Check copilot CLI
if ! command -v copilot &>/dev/null; then
  echo "ERROR: copilot CLI not found in PATH"
  exit 1
fi

# Check atlas-db script exists
if [[ ! -f "$ATLAS" ]]; then
  echo "ERROR: atlas-db script not found at $ATLAS"
  exit 1
fi

# Check assistant.db isn't corrupt (quick integrity test)
DB_FILE="$ASSISTANT_DIR/data/state/assistant.db"
if [[ -f "$DB_FILE" ]]; then
  if ! python3 -c "import sqlite3; c=sqlite3.connect('$DB_FILE'); c.execute('PRAGMA integrity_check')" 2>/dev/null; then
    echo "ERROR: assistant.db may be corrupt. Backing up and continuing."
    cp "$DB_FILE" "${DB_FILE}.corrupt.$(date +%s)"
  fi
fi

# Max recap window: meetings that ended more than this many minutes ago are skipped.
MAX_AGE_MIN="${MEETING_RECAP_MAX_AGE:-60}"

cd "$ASSISTANT_DIR"

# Step 1: Fetch today's meetings that have ended.
# Ask for all meetings from today, including those that already ended.
EVENTS_JSON=$(perl -e 'alarm 60; exec @ARGV' -- copilot \
  --agent=morning-briefing \
  -p "List ALL of my calendar events for today (${DATE}) that have already ended. Include meetings that ended in the last ${MAX_AGE_MIN} minutes. Output ONLY a JSON array (no prose, no markdown fences) where each element has: event_id, title, start (ISO 8601 with timezone), end (ISO 8601 with timezone), attendees (array of {name,email}), and external_count (count of attendees whose email domain differs from your employer domain)." \
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
  echo "No ended events returned from calendar (or parse failed). Exiting."
  exit 0
fi

# Step 2: Filter via the ledger — only unrecapped meetings within the window.
RECAP_PENDING=$(echo "$EVENTS_JSON" | python3 "$ATLAS" meeting recap-pending --max-age-min "$MAX_AGE_MIN")
RECAP_COUNT=$(echo "$RECAP_PENDING" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")

echo "Meetings needing recap: $RECAP_COUNT"

if [[ "$RECAP_COUNT" -eq 0 ]]; then
  exit 0
fi

# Step 3: Recap each meeting.
echo "$RECAP_PENDING" | python3 -c "
import sys, json
for ev in json.load(sys.stdin):
    print('\t'.join([
        ev.get('event_id', ''),
        ev.get('title', ''),
        ev.get('start', ''),
        ev.get('end', ''),
        json.dumps(ev.get('attendees', [])),
        str(ev.get('external_count', 0))
    ]))
" | while IFS=$'\t' read -r EVENT_ID TITLE START END ATTENDEES EXT_COUNT; do
  echo ""
  echo "--- Recapping: $TITLE (ended $(python3 -c "
from datetime import datetime, timezone
end = datetime.fromisoformat('${END}'.replace('Z', '+00:00'))
now = datetime.now(timezone.utc)
mins = int((now - end).total_seconds() / 60)
print(f'{mins} min ago')
")) ---"

  if perl -e 'alarm 120; exec @ARGV' -- copilot \
    --agent=meeting-recap-auto \
    -p "Recap meeting: event_id=${EVENT_ID}, title=\"${TITLE}\", start=${START}, end=${END}, attendees=${ATTENDEES}, external_count=${EXT_COUNT}" \
    --allow-tool='shell' \
    --allow-tool='write' \
    --allow-tool='workiq' \
    --allow-tool='outlook' \
    --allow-tool='teams' \
    --allow-tool='memory' \
    --deny-tool='shell(rm)' \
    --deny-tool='shell(git push)'; then
    SHORT_TITLE=$(echo "$TITLE" | cut -c1-40)
    osascript -e "display notification \"Recap saved: ${SHORT_TITLE}\" with title \"Atlas\" sound name \"Glass\"" || true
  else
    echo "ERROR: recap generation failed for $TITLE"
    python3 "$ATLAS" meeting mark "$EVENT_ID" --status recap-failed 2>/dev/null || true
    osascript -e "display notification \"Recap FAILED: ${TITLE}\" with title \"Atlas\" sound name \"Sosumi\"" || true
  fi
done

echo "=== Finished: $(date '+%H:%M:%S') ==="
