#!/bin/zsh
# end-of-day-auto.sh
# Triggered by launchd at 8:00 PM weekdays.
# Runs the end-of-day agent headlessly if it hasn't already run today.

set -euo pipefail

DATE=$(date +%Y-%m-%d)
AUTOMATION_DIR="$HOME/projects/personal/assistant/automation"
LOG_DIR="$AUTOMATION_DIR/logs"
LOG_FILE="$LOG_DIR/end-of-day-auto-${DATE}.log"
EOD_SENTINEL="$LOG_DIR/eod-complete-${DATE}.sentinel"

mkdir -p "$LOG_DIR"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== End-of-Day Auto: $(date '+%Y-%m-%d %H:%M:%S') ==="

# Time-of-day guard: only run between 7 PM and 11 PM
# Prevents RunAtLoad from triggering outside the evening window
CURRENT_HOUR=$(date +%H)
if [[ $CURRENT_HOUR -lt 19 || $CURRENT_HOUR -ge 23 ]]; then
  echo "Skipping: outside evening window (current hour: $CURRENT_HOUR, allowed: 7-11 PM)"
  exit 0
fi

# Already-ran guard: check if EOD was completed today
# Sentinel file is written at the end of a successful run
if [[ -f "$EOD_SENTINEL" ]]; then
  echo "Skipping: end-of-day already completed today ($(cat "$EOD_SENTINEL"))"
  exit 0
fi

# Also check if a journal was written today (covers manual runs)
WORK_JOURNAL="$HOME/Library/CloudStorage/OneDrive-Microsoft/journals/work/${DATE}.md"
if [[ -f "$WORK_JOURNAL" ]]; then
  echo "Skipping: work journal already exists for today ($WORK_JOURNAL)"
  echo "Manual end-of-day was likely already run."
  touch "$EOD_SENTINEL" && echo "$(date '+%H:%M:%S') via journal check" > "$EOD_SENTINEL"
  exit 0
fi

if ! command -v copilot &>/dev/null; then
  echo "ERROR: copilot CLI not found in PATH"
  osascript -e 'display notification "End-of-day auto failed: copilot not found." with title "Atlas" sound name "Sosumi"'
  exit 1
fi

cd "$HOME/projects/personal"

echo "Starting end-of-day agent..."
osascript -e 'display notification "Running end-of-day wrap-up automatically..." with title "Atlas" sound name "Glass"'

if perl -e 'alarm 600; exec @ARGV' -- copilot \
  --agent=end-of-day \
  -p "Run my end-of-day wrap-up for ${DATE}. This is an automated run at 8 PM — no interactive questions. Make good decisions autonomously, skip anything that needs my input, complete all journaling and task sync." \
  --allow-tool='shell' \
  --allow-tool='write' \
  --allow-tool='workiq' \
  --allow-tool='gmail' \
  --allow-tool='outlook' \
  --allow-tool='hmbl-mail' \
  --allow-tool='memory' \
  --deny-tool='shell(rm)' \
  --deny-tool='shell(git push)'; then
  EXIT_CODE=0
else
  EXIT_CODE=$?
fi

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "$(date '+%H:%M:%S') automated run" > "$EOD_SENTINEL"
  echo "End-of-day completed successfully."
  osascript -e 'display notification "End-of-day wrap-up complete." with title "Atlas" sound name "Glass"'
else
  echo "End-of-day agent exited with code $EXIT_CODE."
  osascript -e 'display notification "End-of-day auto run had issues. Check logs." with title "Atlas" sound name "Sosumi"'
fi

echo "=== Finished: $(date '+%H:%M:%S') ==="
