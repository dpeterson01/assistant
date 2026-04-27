#!/bin/zsh
# end-of-day-auto.sh
# Triggered by launchd at 8:00 PM, 9:00 PM, and 10:00 PM weekdays (retry pattern).
# Also handles catch-up: if RunAtLoad fires in the morning and yesterday's EOD was missed,
# runs a retroactive EOD for the prior day.
#
# The sentinel file (eod-complete-YYYY-MM-DD.sentinel) prevents duplicate runs.

set -euo pipefail

DATE=$(date +%Y-%m-%d)
ASSISTANT_DIR="$HOME/projects/personal/assistant"
AUTOMATION_DIR="$ASSISTANT_DIR/automation"
LOG_DIR="$AUTOMATION_DIR/logs"
LOG_FILE="$LOG_DIR/end-of-day-auto-${DATE}.log"
EOD_SENTINEL="$LOG_DIR/eod-complete-${DATE}.sentinel"

mkdir -p "$LOG_DIR"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== End-of-Day Auto: $(date '+%Y-%m-%d %H:%M:%S') ==="

CURRENT_HOUR=$(date +%H)

# --- Catch-up logic: if it's morning and yesterday's EOD was missed ---
# RunAtLoad fires on wake/login. If we missed yesterday, run a retroactive EOD.
if [[ $CURRENT_HOUR -ge 5 && $CURRENT_HOUR -lt 12 ]]; then
  # Calculate yesterday's date (macOS date syntax)
  YESTERDAY=$(date -v-1d +%Y-%m-%d)
  YESTERDAY_DOW=$(date -v-1d +%u)  # 1=Mon ... 7=Sun
  YESTERDAY_SENTINEL="$LOG_DIR/eod-complete-${YESTERDAY}.sentinel"
  YESTERDAY_JOURNAL="$HOME/Library/CloudStorage/OneDrive-Microsoft/journals/work/${YESTERDAY}.md"

  # Only catch up weekdays (Mon-Fri = 1-5) that don't already have a sentinel or journal
  if [[ $YESTERDAY_DOW -le 5 && ! -f "$YESTERDAY_SENTINEL" && ! -f "$YESTERDAY_JOURNAL" ]]; then
    echo "Catch-up: yesterday ($YESTERDAY) EOD was missed. Running retroactive EOD."
    osascript -e "display notification \"Running missed EOD for $YESTERDAY...\" with title \"Atlas\" sound name \"Glass\"" 2>/dev/null || true

    if command -v copilot &>/dev/null; then
      cd "$HOME/projects/personal"
      if perl -e 'alarm 600; exec @ARGV' -- copilot \
        --agent=end-of-day \
        -p "Run a retroactive end-of-day wrap-up for ${YESTERDAY} (yesterday). The automated 8 PM run was missed because the Mac was likely asleep. Gather what you can from Things 3 completed items, emails, and meetings for that date. Write journals and sync tasks. This is automated — no interactive questions." \
        --allow-tool='shell' \
        --allow-tool='write' \
        --allow-tool='workiq' \
        --allow-tool='gmail' \
        --allow-tool='outlook' \
        --allow-tool='hmbl-mail' \
        --allow-tool='memory' \
        --deny-tool='shell(rm)' \
        --deny-tool='shell(git push)'; then
        echo "$(date '+%H:%M:%S') catch-up run" > "$YESTERDAY_SENTINEL"
        echo "Catch-up EOD for $YESTERDAY completed successfully."
        osascript -e "display notification \"Catch-up EOD for $YESTERDAY complete.\" with title \"Atlas\" sound name \"Glass\"" 2>/dev/null || true
      else
        echo "Catch-up EOD for $YESTERDAY failed (exit code $?)."
        osascript -e "display notification \"Catch-up EOD for $YESTERDAY failed. Check logs.\" with title \"Atlas\" sound name \"Sosumi\"" 2>/dev/null || true
      fi
    else
      echo "Catch-up: copilot CLI not found, skipping."
    fi
  else
    if [[ $YESTERDAY_DOW -gt 5 ]]; then
      echo "Catch-up: yesterday was a weekend, skipping."
    else
      echo "Catch-up: yesterday ($YESTERDAY) already has sentinel or journal, skipping."
    fi
  fi

  echo "Morning catch-up check complete. Exiting (not running today's EOD in morning)."
  exit 0
fi

# --- Normal evening run ---

# Time-of-day guard: only run between 7 PM and 11 PM
# The retry plist fires at 8, 9, and 10 PM. Sentinel prevents duplicates.
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
  echo "$(date '+%H:%M:%S') via journal check" > "$EOD_SENTINEL"
  exit 0
fi

if ! command -v copilot &>/dev/null; then
  echo "ERROR: copilot CLI not found in PATH"
  osascript -e 'display notification "End-of-day auto failed: copilot not found." with title "Atlas" sound name "Sosumi"'
  exit 1
fi

cd "$HOME/projects/personal"

echo "Starting end-of-day agent (attempt at $(date '+%H:%M'))..."
osascript -e 'display notification "Running end-of-day wrap-up automatically..." with title "Atlas" sound name "Glass"'

if perl -e 'alarm 600; exec @ARGV' -- copilot \
  --agent=end-of-day \
  -p "Run my end-of-day wrap-up for ${DATE}. Today is $(date '+%A %B %d, %Y'). This is an automated run — no interactive questions. Make good decisions autonomously, skip anything that needs my input, complete all journaling and task sync." \
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
  osascript -e "display notification \"End-of-day failed (attempt $(date '+%H:%M')). Will retry next hour.\" with title \"Atlas\" sound name \"Sosumi\""
fi

echo "=== Finished: $(date '+%H:%M:%S') ==="
