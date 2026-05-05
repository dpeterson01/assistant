#!/bin/zsh
# Briefing Sync — runs every 15 min during work hours.
# 0) EMAIL CLEANUP: filter spam from journals + sweep Outlook junk
# 1) PULL: scan for new inbound items → dashboard JSON
#
# Triggered by launchd: com.atlas.briefing-sync.plist

set -euo pipefail

DASHBOARD_URL="http://localhost:3141"
THINGS3_DIR="$HOME/.local/bin/things3"
ASSISTANT_DIR="$HOME/projects/personal/assistant"
ACTION_ITEMS="$ASSISTANT_DIR/data/context/action-items.md"
AUTOMATION_DIR="$ASSISTANT_DIR/automation"
LOG_DIR="$AUTOMATION_DIR/logs"
DATE=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/briefing-sync-${DATE}.log"
mkdir -p "$LOG_DIR"

exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== Briefing Sync: $(date '+%Y-%m-%d %H:%M:%S') ==="

# Time-of-day guard: weekdays 7 AM - 7 PM, weekends 8 AM - 10 PM
CURRENT_HOUR=$(date +%H)
DAY_OF_WEEK=$(date +%u)  # 1=Mon, 7=Sun
if [[ $DAY_OF_WEEK -ge 6 ]]; then
  # Weekends: relaxed hours
  if [[ $CURRENT_HOUR -lt 8 || $CURRENT_HOUR -ge 22 ]]; then
    echo "Skipping: outside weekend hours (${CURRENT_HOUR}h)"
    exit 0
  fi
else
  # Weekdays
  if [[ $CURRENT_HOUR -lt 7 || $CURRENT_HOUR -ge 19 ]]; then
    echo "Skipping: outside work hours (${CURRENT_HOUR}h)"
    exit 0
  fi
fi

# Check if dashboard server is running
if ! curl -sf "$DASHBOARD_URL/api/briefing" > /dev/null 2>&1; then
  echo "Dashboard not running. Skipping sync."
  exit 0
fi

# ──────────────────────────────────────────────
# PHASE 0: EMAIL CLEANUP
#   0a: filter spam/marketing lines from journal files
#   0b: sweep Outlook junk folder (delete matched, log unmatched)
# ──────────────────────────────────────────────

echo "--- Phase 0a: Journal email cleanup ---"
FILTER_SCRIPT="$ASSISTANT_DIR/filter-scripts/filter-spam-emails.py"
if [[ -f "$FILTER_SCRIPT" ]]; then
  if python3 "$FILTER_SCRIPT" --apply 2>&1; then
    echo "  ✓ Journal email cleanup complete"
  else
    echo "  ✗ Journal email cleanup failed (exit $?), continuing"
  fi
else
  echo "  - Filter script not found, skipping"
fi

echo "--- Phase 0b: Outlook junk mail sweep ---"
JUNK_SCRIPT="$HOME/.local/share/outlook-mcp/email_cleanup.py"
if [[ -f "$JUNK_SCRIPT" ]]; then
  # Auto-delete matched spam (quiet mode for scheduled runs)
  if cd "$(dirname "$JUNK_SCRIPT")" && uv run email_cleanup.py junk --apply --limit 50 --quiet 2>&1; then
    echo "  ✓ Junk mail sweep complete"
  else
    echo "  ✗ Junk mail sweep failed (exit $?), continuing"
  fi
  # Dry-run pass to count unmatched items for logging
  UNMATCHED_COUNT=$(cd "$(dirname "$JUNK_SCRIPT")" && uv run email_cleanup.py junk --limit 50 2>&1 | grep -c "^UNMATCHED" || true)
  if [[ "$UNMATCHED_COUNT" -gt 0 ]]; then
    echo "  ⚠ ${UNMATCHED_COUNT} unmatched junk items to review"
  fi
  cd "$ASSISTANT_DIR"
else
  echo "  - Junk mail script not found, skipping"
fi

# ──────────────────────────────────────────────
# PHASE 1: PULL — scan for new inbound items
# ──────────────────────────────────────────────

echo "--- Phase 1: Pull new items ---"

if ! command -v copilot &>/dev/null; then
  echo "Copilot CLI not found. Skipping pull."
else
    # Get lastUpdated from briefing JSON to scope the scan
    BRIEFING=$(curl -sf "$DASHBOARD_URL/api/briefing")
    LAST_UPDATED=$(echo "$BRIEFING" | python3 -c "import sys,json; print(json.load(sys.stdin).get('lastUpdated',''))")
    BRIEFING_DATE=$(echo "$BRIEFING" | python3 -c "import sys,json; print(json.load(sys.stdin).get('date',''))")

    echo "Pulling new items since $LAST_UPDATED"

    cd "$HOME/projects/personal"

    # Run Copilot CLI with a focused inbound-scan prompt
    if perl -e 'alarm 180; exec @ARGV' -- copilot \
      --agent=morning-briefing \
      -p "Inbound scan for the briefing dashboard (${BRIEFING_DATE}).

Scan for NEW communications since ${LAST_UPDATED}:
1. Check Outlook work email ([work-email]) for unread emails
2. Check Teams for unread mentions or direct messages
3. Check personal Outlook ([personal-email]) for anything urgent

For each new item found:
- Triage as HIGH/MEDIUM/LOW using the standard triage rules
- Skip LOW items (just count them)

Then PATCH the dashboard at ${DASHBOARD_URL}/api/briefing with this payload format:
{
  \"date\": \"${BRIEFING_DATE}\",
  \"inbox\": [
    {
      \"id\": \"<kebab-case-slug>\",
      \"text\": \"<sender>: <subject summary>\",
      \"detail\": \"<1-2 sentence context>\",
      \"priority\": \"high|medium\",
      \"status\": \"open\",
      \"source\": \"email|teams\",
      \"channel\": \"outlook-work|outlook-personal|teams\",
      \"sender\": \"<display name>\",
      \"emailId\": \"<message ID or null>\",
      \"threadId\": null
    }
  ],
  \"inboxLowCount\": <add to existing count>
}

Use curl to PATCH: curl -sf -X PATCH ${DASHBOARD_URL}/api/briefing -H 'Content-Type: application/json' -d '<json>'

If no new items found, just report that. Do not duplicate items already in the dashboard." \
      --allow-tool='shell(curl)' \
      --allow-tool='workiq' \
      --allow-tool='gmail' \
      --allow-tool='outlook' \
      --deny-tool='shell(rm)' \
      --deny-tool='shell(git push)' 2>&1; then
      echo "Pull completed successfully"
    else
      echo "Pull failed (exit $?), will retry next cycle"
    fi
  fi

echo "=== Sync complete: $(date '+%Y-%m-%d %H:%M:%S') ==="
