#!/bin/zsh
# Morning Briefing Automation Script
# Triggered by launchd at 6:30 AM weekdays
# Runs Copilot CLI headlessly to generate the daily briefing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTOMATION_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$AUTOMATION_DIR/logs"
DATE=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/morning-briefing-${DATE}.log"

mkdir -p "$LOG_DIR"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== Morning Briefing: $(date '+%Y-%m-%d %H:%M:%S') ==="

# Time-of-day guard: only run between 5:00 AM and 10:00 AM
# Prevents RunAtLoad from re-triggering the briefing if Mac restarts mid-day
CURRENT_HOUR=$(date +%H)
if [[ $CURRENT_HOUR -lt 5 || $CURRENT_HOUR -ge 10 ]]; then
  echo "Skipping: outside morning window (current hour: $CURRENT_HOUR, allowed: 5-9 AM)"
  exit 0
fi

# Keep machine awake for the duration
caffeinate -i -t 900 &
CAFFEINATE_PID=$!

# Ensure cleanup on exit
cleanup() {
    kill $CAFFEINATE_PID 2>/dev/null || true
    echo "=== Finished: $(date '+%H:%M:%S') ==="
}
trap cleanup EXIT

# Check if Copilot CLI is available
if ! command -v copilot &>/dev/null; then
    echo "ERROR: copilot CLI not found in PATH"
    osascript -e 'display notification "Copilot CLI not found. Run briefing manually." with title "Atlas" sound name "Sosumi"'
    exit 1
fi

# Check if already ran today
BRIEFING_FILE="$HOME/projects/personal/assistant/briefings/${DATE}_daily_brief.md"
if [[ -f "$BRIEFING_FILE" ]]; then
    echo "Briefing already exists for today. Skipping."
    osascript -e 'display notification "Briefing already exists for today." with title "Atlas"'
    exit 0
fi

# Run the morning briefing agent
echo "Starting Copilot CLI morning-briefing agent..."
cd "$HOME/projects/personal"

# mac-messages is always available (replaced iMCP which had Bonjour timeout issues)

# Build the copilot command with a 10-minute timeout (perl used; macOS lacks GNU timeout)
COPILOT_CMD=(perl -e 'alarm 600; exec @ARGV' -- copilot
    --agent=morning-briefing
    -p "Run my full morning briefing for today, $(date '+%A %B %d, %Y'). Write the briefing to assistant/briefings/${DATE}_daily_brief.md and open it in Typora when done."
    --allow-tool='shell'
    --allow-tool='write'
    --allow-tool='workiq'
    --allow-tool='gmail'
    --allow-tool='outlook'
    --allow-tool='hmbl-mail'
    --allow-tool='memory'
    --allow-tool='mac-messages'
    --deny-tool='shell(rm)'
    --deny-tool='shell(git push)'
)

"${COPILOT_CMD[@]}" 2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}

if [[ $EXIT_CODE -eq 0 ]]; then
    echo "Morning briefing completed successfully."
    osascript -e 'display notification "Morning briefing ready. Check Typora." with title "Atlas" sound name "Glass"'
    # Update manifest with last run time
    MANIFEST="$AUTOMATION_DIR/manifest.json"
    if [[ -f "$MANIFEST" ]]; then
        python3 -c "
import json
with open('$MANIFEST') as f: m = json.load(f)
for t in m['tasks']:
    if t['id'] == 'morning-briefing':
        t['last_run'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
        t['last_status'] = 'success'
with open('$MANIFEST', 'w') as f: json.dump(m, f, indent=2)
" 2>/dev/null || true
    fi
else
    echo "Morning briefing failed with exit code $EXIT_CODE"
    osascript -e 'display notification "Morning briefing failed. Check logs." with title "Atlas" sound name "Sosumi"'
    # Update manifest
    MANIFEST="$AUTOMATION_DIR/manifest.json"
    if [[ -f "$MANIFEST" ]]; then
        python3 -c "
import json
with open('$MANIFEST') as f: m = json.load(f)
for t in m['tasks']:
    if t['id'] == 'morning-briefing':
        t['last_run'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
        t['last_status'] = 'failed'
with open('$MANIFEST', 'w') as f: json.dump(m, f, indent=2)
" 2>/dev/null || true
    fi
fi
