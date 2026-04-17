#!/bin/zsh
# Things 3 — Show task details by ID
# Usage: show.sh <task-id>
#        show.sh --search "keyword"
if [[ -z "$1" ]]; then
  echo "Usage: show.sh <task-id>"
  echo "       show.sh --search \"keyword\""
  exit 1
fi

THINGS_DB="$HOME/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-BX8ZL/Things Database.thingsdatabase/main.sqlite"

if [[ "$1" == "--search" ]]; then
  QUERY="%${2}%"
  TASK_ID=$(sqlite3 "$THINGS_DB" "
    SELECT uuid FROM TMTask
    WHERE title LIKE '$QUERY' AND trashed = 0 AND type = 0
    ORDER BY creationDate DESC LIMIT 1;
  " 2>/dev/null)
  if [[ -z "$TASK_ID" ]]; then
    echo "No task found matching: $2"
    exit 1
  fi
else
  TASK_ID="$1"
fi

# Things date decoder: startDate/deadline are packed as (year<<16)|(month<<12)|((day/2)<<8)|(odd?0x80:0)
# creationDate/userModificationDate are Unix timestamps
sqlite3 "$THINGS_DB" "
  SELECT
    'Title: ' || t.title,
    'ID: ' || t.uuid,
    'Status: ' || CASE t.status WHEN 0 THEN 'open' WHEN 3 THEN 'completed' WHEN 2 THEN 'canceled' ELSE t.status END,
    'Project: ' || COALESCE(p.title, '(none)'),
    'Area: ' || COALESCE(a.title, COALESCE(pa.title, '(none)')),
    'When: ' || CASE WHEN t.startDate IS NOT NULL THEN
      printf('%04d-%02d-%02d', t.startDate >> 16, (t.startDate >> 12) & 0xF, ((t.startDate >> 8) & 0xF) * 2 + CASE WHEN (t.startDate & 0x80) != 0 THEN 1 ELSE 0 END)
      ELSE '(not set)' END,
    'Deadline: ' || CASE WHEN t.deadline IS NOT NULL THEN
      printf('%04d-%02d-%02d', t.deadline >> 16, (t.deadline >> 12) & 0xF, ((t.deadline >> 8) & 0xF) * 2 + CASE WHEN (t.deadline & 0x80) != 0 THEN 1 ELSE 0 END)
      ELSE '(not set)' END,
    'Created: ' || datetime(t.creationDate, 'unixepoch', 'localtime'),
    'Modified: ' || datetime(t.userModificationDate, 'unixepoch', 'localtime'),
    'Notes: ' || COALESCE(SUBSTR(t.notes, 1, 500), '(none)')
  FROM TMTask t
  LEFT JOIN TMTask p ON t.project = p.uuid
  LEFT JOIN TMArea a ON t.area = a.uuid
  LEFT JOIN TMArea pa ON p.area = pa.uuid
  WHERE t.uuid = '$TASK_ID';
" 2>/dev/null | while IFS='|' read -r line; do echo "$line"; done

# Tags
TAGS=$(sqlite3 "$THINGS_DB" "
  SELECT group_concat(tag.title, ', ')
  FROM TMTaskTag tt
  JOIN TMTag tag ON tt.tags = tag.uuid
  WHERE tt.tasks = '$TASK_ID';
" 2>/dev/null)
echo "Tags: ${TAGS:-(none)}"

# Checklist
CHECKLIST_COUNT=$(sqlite3 "$THINGS_DB" "SELECT count(*) FROM TMChecklistItem WHERE task = '$TASK_ID';" 2>/dev/null)
if [[ "$CHECKLIST_COUNT" -gt 0 ]]; then
  echo "Checklist:"
  sqlite3 "$THINGS_DB" "
    SELECT CASE WHEN status = 3 THEN '  [x] ' ELSE '  [ ] ' END || title
    FROM TMChecklistItem
    WHERE task = '$TASK_ID'
    ORDER BY \"index\" ASC;
  "
fi
