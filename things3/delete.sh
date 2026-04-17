#!/bin/zsh
# Things 3 — Delete (trash) a task by ID
# Usage: delete.sh <task-id>
#        delete.sh --search "keyword"  (trashes first matching open task)
# Find task IDs with: search.sh "keyword"
if [[ -z "$1" ]]; then
  echo "Usage: delete.sh <task-id>"
  echo "       delete.sh --search \"keyword\""
  exit 1
fi

THINGS_DB="$HOME/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-BX8ZL/Things Database.thingsdatabase/main.sqlite"

if [[ "$1" == "--search" ]]; then
  QUERY="%${2}%"
  TASK_ID=$(sqlite3 "$THINGS_DB" "
    SELECT uuid FROM TMTask
    WHERE title LIKE '$QUERY' AND trashed = 0 AND type = 0 AND status = 0
    ORDER BY creationDate DESC LIMIT 1;
  " 2>/dev/null)
  if [[ -z "$TASK_ID" ]]; then
    echo "No open task found matching: $2"
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

echo "Trashing: $TASK_NAME"
osascript -e "tell application \"Things3\" to move to do id \"$TASK_ID\" to list \"Trash\""
