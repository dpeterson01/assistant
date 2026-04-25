#!/bin/zsh
# Briefing Sync — runs every 15 min during work hours.
# 1) PUSH: propagate dashboard completions → Things 3, action-items.md
# 2) PULL: (stub) scan for new inbound items → dashboard JSON
#
# Triggered by launchd: com.derekpeterson.briefing-sync.plist

set -euo pipefail

DASHBOARD_URL="http://localhost:3141"
THINGS3_DIR="$HOME/.local/bin/things3"
ACTION_ITEMS="$HOME/projects/personal/assistant/context/action-items.md"
AUTOMATION_DIR="$HOME/projects/personal/assistant/automation"
LOG_DIR="$AUTOMATION_DIR/logs"
DATE=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/briefing-sync-${DATE}.log"
mkdir -p "$LOG_DIR"

exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== Briefing Sync: $(date '+%Y-%m-%d %H:%M:%S') ==="

# Time-of-day guard: 7 AM - 7 PM weekdays only
CURRENT_HOUR=$(date +%H)
DAY_OF_WEEK=$(date +%u)  # 1=Mon, 7=Sun
if [[ $DAY_OF_WEEK -ge 6 ]]; then
  echo "Skipping: weekend"
  exit 0
fi
if [[ $CURRENT_HOUR -lt 7 || $CURRENT_HOUR -ge 19 ]]; then
  echo "Skipping: outside work hours (${CURRENT_HOUR}h)"
  exit 0
fi

# Check if dashboard server is running
if ! curl -sf "$DASHBOARD_URL/api/briefing" > /dev/null 2>&1; then
  echo "Dashboard not running. Skipping sync."
  exit 0
fi

# ──────────────────────────────────────────────
# PHASE 1: PUSH — propagate completions outward
# ──────────────────────────────────────────────

echo "--- Phase 1: Push completions ---"

# Get all items with syncPending across all sections
BRIEFING=$(curl -sf "$DASHBOARD_URL/api/briefing")

# Extract syncPending items using python (available on macOS)
PENDING=$(echo "$BRIEFING" | python3 -c "
import sys, json

data = json.load(sys.stdin)
pending = []
for section in ['carryOver', 'inbox', 'tasks']:
    for item in data.get(section, []):
        if item.get('syncPending'):
            pending.append({
                'id': item['id'],
                'text': item.get('text', ''),
                'status': item['status'],
                'section': section,
                'channel': item.get('channel'),
                'emailId': item.get('emailId'),
            })
json.dump(pending, sys.stdout)
")

PENDING_COUNT=$(echo "$PENDING" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "Found $PENDING_COUNT items to sync"

if [[ "$PENDING_COUNT" -gt 0 ]]; then
  # Process each pending item and write synced IDs to temp file
  echo "$PENDING" | python3 -c "
import sys, json, subprocess, os

items = json.load(sys.stdin)
things3_dir = os.path.expanduser('~/.local/bin/things3')
synced_ids = []

for item in items:
    item_id = item['id']
    text = item['text']
    status = item['status']
    print(f'  Syncing: {text} ({status})', file=sys.stderr)

    if status == 'done':
        # 1. Complete in Things 3
        try:
            # Try task-id first (AI- prefixed IDs)
            if item_id.startswith('AI-'):
                subprocess.run(
                    [os.path.join(things3_dir, 'complete.sh'), '--task-id', item_id],
                    timeout=10, capture_output=True
                )
            else:
                subprocess.run(
                    [os.path.join(things3_dir, 'complete.sh'), '--search', text],
                    timeout=10, capture_output=True
                )
            print(f'    ✓ Things 3', file=sys.stderr)
        except Exception as e:
            print(f'    ✗ Things 3: {e}', file=sys.stderr)

    synced_ids.append(item_id)

# Write synced IDs to temp file
with open('/tmp/briefing-synced-ids.json', 'w') as f:
    json.dump(synced_ids, f)
" 2>&1

  # Read synced IDs and build PATCH payload to clear syncPending + stamp syncedAt
  python3 -c "
import sys, json, urllib.request, datetime

with open('/tmp/briefing-synced-ids.json') as f:
    synced_ids = json.load(f)

if not synced_ids:
    sys.exit(0)

# Read current briefing to find items and their sections
req = urllib.request.Request('$DASHBOARD_URL/api/briefing')
with urllib.request.urlopen(req) as resp:
    data = json.load(resp)

ts = datetime.datetime.now().isoformat()
patch = {'date': data['date']}

for section in ['carryOver', 'inbox', 'tasks']:
    updates = []
    for item in data.get(section, []):
        if item['id'] in synced_ids:
            updates.append({
                'id': item['id'],
                'syncPending': False,
                'syncedAt': ts
            })
    if updates:
        patch[section] = updates

payload = json.dumps(patch).encode()
req = urllib.request.Request(
    '$DASHBOARD_URL/api/briefing',
    data=payload,
    headers={'Content-Type': 'application/json'},
    method='PATCH'
)
with urllib.request.urlopen(req) as resp:
    result = json.load(resp)
    print(f'  PATCH result: updateCount={result.get(\"updateCount\")}')
"

  # Update action-items.md: move completed items to Completed section
  # Uses the dashboard API for item text lookup (no regex parsing of markdown)
  python3 -c "
import json, re, datetime, os, urllib.request

with open('/tmp/briefing-synced-ids.json') as f:
    synced_ids = json.load(f)

if not synced_ids:
    exit(0)

action_items_path = os.path.expanduser('$ACTION_ITEMS')
if not os.path.exists(action_items_path):
    print('  - action-items.md not found, skipping')
    exit(0)

with open(action_items_path, 'r') as f:
    content = f.read()

# Get item details from dashboard API
req = urllib.request.Request('$DASHBOARD_URL/api/briefing')
with urllib.request.urlopen(req) as resp:
    data = json.load(resp)

# Build id->text map
id_text = {}
for section in ['carryOver', 'inbox', 'tasks']:
    for item in data.get(section, []):
        id_text[item['id']] = item.get('text', item['id'])

today = datetime.date.today().strftime('%Y-%m-%d')
completed_lines = []

for sid in synced_ids:
    text = id_text.get(sid, sid)
    moved = False

    # Match by Task ID first (deterministic, no regex fragility)
    if sid.startswith('AI-'):
        pattern = rf'^- \[ \] .*Task ID:\s*{re.escape(sid)}.*\n?'
        content, n = re.subn(pattern, '', content, count=1, flags=re.MULTILINE)
        if n > 0:
            moved = True

    # Fall back to item id in line
    if not moved:
        pattern = rf'^- \[ \] .*\b{re.escape(sid)}\b.*\n?'
        content, n = re.subn(pattern, '', content, count=1, flags=re.MULTILINE)
        if n > 0:
            moved = True

    # Last resort: match first 30 chars of text
    if not moved and text:
        escaped = re.escape(text[:30])
        pattern = rf'^- \[ \] .*{escaped}.*\n?'
        content, n = re.subn(pattern, '', content, count=1, flags=re.MULTILINE)
        if n > 0:
            moved = True

    if moved:
        completed_lines.append(f'- [x] {text} | Completed: {today}')
        print(f'  ✓ action-items.md: moved \"{text}\" to completed')
    else:
        print(f'  - action-items.md: \"{text}\" not found in active (may already be moved)')

if completed_lines:
    marker = '## Completed (last 7 days, auto-pruned)'
    if marker in content:
        insert_point = content.index(marker) + len(marker)
        insert_text = '\n' + '\n'.join(completed_lines)
        content = content[:insert_point] + insert_text + content[insert_point:]
    with open(action_items_path, 'w') as f:
        f.write(content)
" 2>&1

  rm -f /tmp/briefing-synced-ids.json
fi

# ──────────────────────────────────────────────
# PHASE 2: PULL — scan for new inbound items
# ──────────────────────────────────────────────

echo "--- Phase 2: Pull new items ---"

if ! command -v copilot &>/dev/null; then
  echo "Copilot CLI not found. Skipping pull."
else
    # Get lastUpdated from briefing JSON to scope the scan
    LAST_UPDATED=$(echo "$BRIEFING" | python3 -c "import sys,json; print(json.load(sys.stdin).get('lastUpdated',''))")
    BRIEFING_DATE=$(echo "$BRIEFING" | python3 -c "import sys,json; print(json.load(sys.stdin).get('date',''))")

    echo "Pulling new items since $LAST_UPDATED"

    cd "$HOME/projects/personal"

    # Run Copilot CLI with a focused inbound-scan prompt
    if perl -e 'alarm 180; exec @ARGV' -- copilot \
      --agent=morning-briefing \
      -p "Inbound scan for the briefing dashboard (${BRIEFING_DATE}).

Scan for NEW communications since ${LAST_UPDATED}:
1. Check Outlook work email (depeters@microsoft.com) for unread emails
2. Check Teams for unread mentions or direct messages
3. Check personal Outlook (drp80@outlook.com) for anything urgent

For each new item found:
- Triage as HIGH/MEDIUM/LOW using the standard triage rules
- Score draft confidence (0.0-1.0)
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
      \"threadId\": null,
      \"draftConfidence\": <0.0-1.0 or null>,
      \"draftReason\": \"<one line or null>\"
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
      --allow-tool='hmbl-mail' \
      --deny-tool='shell(rm)' \
      --deny-tool='shell(git push)' 2>&1; then
      echo "Pull completed successfully"
    else
      echo "Pull failed (exit $?), will retry next cycle"
    fi
  fi

echo "=== Sync complete: $(date '+%Y-%m-%d %H:%M:%S') ==="
