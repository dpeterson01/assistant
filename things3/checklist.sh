#!/bin/zsh
# Things 3 — List checklist items for a task
# Usage: checklist.sh <task-id>
#        checklist.sh --search "keyword"
# Shows checklist items with status (open/done)
if [[ -z "$1" ]]; then
  echo "Usage: checklist.sh <task-id>"
  echo "       checklist.sh --search \"keyword\""
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

TASK_NAME=$(sqlite3 "$THINGS_DB" "SELECT title FROM TMTask WHERE uuid = '$TASK_ID';" 2>/dev/null)
if [[ -z "$TASK_NAME" ]]; then
  echo "Task ID not found: $TASK_ID"
  exit 1
fi

echo "Checklist for: $TASK_NAME"
sqlite3 "$THINGS_DB" "
  SELECT CASE WHEN status = 3 THEN '  [x] ' ELSE '  [ ] ' END || title
  FROM TMChecklistItem
  WHERE task = '$TASK_ID'
  ORDER BY \"index\" ASC;
"
