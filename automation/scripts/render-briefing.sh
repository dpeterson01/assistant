#!/bin/zsh
# Render a briefing JSON file to human-readable markdown.
# Usage: render-briefing.sh [YYYY-MM-DD]
# If no date given, uses today. Reads the JSON, writes the .md next to it.

set -euo pipefail

BRIEFINGS_DIR="$HOME/projects/personal/assistant/data/briefings"
DATE="${1:-$(date '+%Y-%m-%d')}"
JSON_FILE="$BRIEFINGS_DIR/${DATE}_daily_brief.json"
MD_FILE="$BRIEFINGS_DIR/${DATE}_daily_brief.md"

if [[ ! -f "$JSON_FILE" ]]; then
  echo "No briefing JSON found at $JSON_FILE" >&2
  exit 1
fi

python3 -c "
import json, sys
from datetime import datetime

with open('$JSON_FILE') as f:
    b = json.load(f)

date_str = b.get('date', '$DATE')
dow = b.get('dayOfWeek', '')
try:
    dt = datetime.strptime(date_str, '%Y-%m-%d')
    header_date = dt.strftime('%a %b %d, %Y')
except ValueError:
    header_date = date_str

lines = [f'# Morning Briefing — {header_date}', '']

# Carry-over
carry = b.get('carryOver', [])
if carry:
    lines.append('## Carry-Over')
    for item in carry:
        pri = item.get('priority', 'medium')
        icon = '🔴' if pri == 'high' else '🟡' if pri == 'medium' else '⚪'
        status = item.get('status', 'open')
        mark = '✅ ' if status == 'done' else ''
        lines.append(f'- {mark}{icon} {item.get(\"text\", \"\")}')
        if item.get('detail'):
            lines.append(f'  {item[\"detail\"]}')
    lines.append('')

# Inbox
inbox = b.get('inbox', [])
if inbox:
    lines.append('## New Communications')
    for item in inbox:
        pri = item.get('priority', 'medium')
        icon = '🔴' if pri == 'high' else '🟡' if pri == 'medium' else '⚪'
        status = item.get('status', 'open')
        mark = '✅ ' if status == 'done' else ''
        lines.append(f'- {mark}{icon} {item.get(\"text\", \"\")}')
        if item.get('detail'):
            lines.append(f'  {item[\"detail\"]}')
    low = b.get('inboxLowCount', 0)
    if low:
        lines.append(f'- ⚪ {low} low-priority items skipped')
    lines.append('')

# Meetings
meetings = b.get('meetings', [])
if meetings:
    lines.append('## Meetings')
    for m in meetings:
        time_str = m.get('time', '')
        lines.append(f'- {time_str} {m.get(\"title\", \"\")}')
        if m.get('detail'):
            lines.append(f'  {m[\"detail\"]}')
    lines.append('')

# Tasks / Action items
tasks = b.get('tasks', b.get('actionItems', []))
if tasks:
    lines.append('## Tasks')
    for item in tasks:
        pri = item.get('priority', 'medium')
        icon = '🔴' if pri == 'high' else '🟡' if pri == 'medium' else '⚪'
        status = item.get('status', 'open')
        mark = '✅ ' if status == 'done' else ''
        lines.append(f'- {mark}{icon} {item.get(\"text\", \"\")}')
        if item.get('detail'):
            lines.append(f'  {item[\"detail\"]}')
    lines.append('')

# Accountability
acc = b.get('accountability', {})
waiting = acc.get('waitingOn', [])
if waiting:
    lines.append('## Waiting On Others')
    for w in waiting:
        lines.append(f'- {w.get(\"who\", \"\")}: {w.get(\"text\", \"\")}')
    lines.append('')

# Day-fit score
score = b.get('dayFitScore')
if score is not None:
    lines.append(f'**Day-fit score**: {score}/100')
    reason = b.get('dayFitReason', '')
    if reason:
        lines.append(f'  {reason}')
    lines.append('')

with open('$MD_FILE', 'w') as f:
    f.write('\n'.join(lines))

print(f'Rendered {len(tasks) + len(inbox) + len(carry)} items to $MD_FILE')
"
