#!/bin/zsh
# Auto Draft Inbox Automation Script
# Triggered by launchd every 30 min during work hours (M-F 8 AM - 6 PM).
# Runs Copilot CLI draft-inbox agent headlessly. Saves drafts to Outlook,
# never sends. Threshold 0.80 by default.

set -uo pipefail

DATE=$(date +%Y-%m-%d)
ASSISTANT_DIR="$HOME/projects/personal/assistant"
AUTOMATION_DIR="$ASSISTANT_DIR/automation"
LOG_DIR="$AUTOMATION_DIR/logs"
LOG_FILE="$LOG_DIR/auto-draft-inbox-${DATE}.log"
mkdir -p "$LOG_DIR"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== Auto Draft Inbox: $(date '+%Y-%m-%d %H:%M:%S') ==="

# Time-of-day guard: only run M-F 8 AM - 6 PM local
DOW=$(date +%u)  # 1-7, Mon-Sun
HOUR=$(date +%H)
if [[ $DOW -gt 5 ]]; then
  echo "Skipping: weekend (DOW=$DOW)"
  exit 0
fi
if [[ $HOUR -lt 8 || $HOUR -ge 18 ]]; then
  echo "Skipping: outside work window (hour=$HOUR, allowed: 8-18)"
  exit 0
fi

if ! command -v copilot &>/dev/null; then
  echo "ERROR: copilot CLI not found in PATH"
  exit 1
fi

cd "$HOME/projects/personal"

# 30-min lookback matches the cron interval. 0.80 threshold is conservative.
PROMPT="Run /draft-inbox --since 30m --threshold 0.80 --inbox work. \
Save drafts to Outlook on the original thread, do not send. \
Report a tight summary and fire a macOS notification only if >=1 draft was saved."

if perl -e 'alarm 600; exec @ARGV' -- copilot \
  --agent=agent \
  -p "$PROMPT" \
  --allow-tool='shell' \
  --allow-tool='write' \
  --allow-tool='mailtools' \
  --allow-tool='outlook' \
  --allow-tool='gmail' \
  --allow-tool='workiq' \
  --allow-tool='memory' \
  --deny-tool='shell(rm)' \
  --deny-tool='shell(git push)' \
  --deny-tool='mailtools(SendDraftMessage)' \
  --deny-tool='mailtools(SendMessage)' \
  --deny-tool='mailtools(ReplyWithFullThread)'; then
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
    if t['id'] == 'auto-draft-inbox':
        t['last_run'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
        t['last_status'] = '$STATUS'
with open('$MANIFEST', 'w') as f: json.dump(m, f, indent=2)
" 2>/dev/null || true
fi

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "Auto draft inbox failed with exit code $EXIT_CODE"
  osascript -e 'display notification "Auto-draft inbox failed. Check automation logs." with title "Atlas" subtitle "Auto Draft" sound name "Sosumi"' || true
fi

exit $EXIT_CODE
