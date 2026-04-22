#!/bin/zsh
# Midday Sync Automation Script
# Triggered by launchd at 12:00 PM weekdays
# Runs Copilot CLI midday-sync agent headlessly, then posts a notification.

set -euo pipefail

DATE=$(date +%Y-%m-%d)
AUTOMATION_DIR="$HOME/projects/personal/assistant/automation"
LOG_DIR="$AUTOMATION_DIR/logs"
LOG_FILE="$LOG_DIR/midday-sync-${DATE}.log"
mkdir -p "$LOG_DIR"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== Midday Sync: $(date '+%Y-%m-%d %H:%M:%S') ==="

# Time-of-day guard: only run between 11:00 AM and 2:00 PM
# Prevents RunAtLoad from re-triggering the sync if Mac restarts outside that window
CURRENT_HOUR=$(date +%H)
if [[ $CURRENT_HOUR -lt 11 || $CURRENT_HOUR -ge 14 ]]; then
  echo "Skipping: outside midday window (current hour: $CURRENT_HOUR, allowed: 11 AM - 2 PM)"
  exit 0
fi

if ! command -v copilot &>/dev/null; then
  echo "ERROR: copilot CLI not found in PATH"
  osascript -e 'display notification "Copilot CLI not found. Run midday sync manually." with title "Atlas" sound name "Sosumi"'
  exit 1
fi

cd "$HOME/projects/personal"

if perl -e 'alarm 300; exec @ARGV' -- copilot \
  --agent=midday-sync \
  -p "Run my midday sync for ${DATE}. Reconcile what has been completed since morning and update Things 3 plus action-items.md." \
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

MANIFEST="$AUTOMATION_DIR/manifest.json"
if [[ -f "$MANIFEST" ]]; then
  if [[ $EXIT_CODE -eq 0 ]]; then
    STATUS="success"
  else
    STATUS="failed"
  fi
  python3 -c "
import json
with open('$MANIFEST') as f: m = json.load(f)
for t in m['tasks']:
    if t['id'] == 'midday-triage':
        t['last_run'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
        t['last_status'] = '$STATUS'
with open('$MANIFEST', 'w') as f: json.dump(m, f, indent=2)
" 2>/dev/null || true
fi

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "Midday sync completed successfully."
  osascript -e 'display notification "Midday sync complete. Task state reconciled." with title "Atlas" subtitle "Midday Sync" sound name "Glass"'
else
  echo "Midday sync failed with exit code $EXIT_CODE"
  osascript -e 'display notification "Midday sync failed. Check automation logs." with title "Atlas" subtitle "Midday Sync" sound name "Sosumi"'
fi
