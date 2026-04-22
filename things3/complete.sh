#!/bin/zsh
# Things 3 — Complete a task by DB id, title search, or stable task ID.
# Usage: complete.sh <task-id>
#        complete.sh --search "keyword"     (completes first matching open task)
#        complete.sh --task-id "AI-..."     (completes first matching open task with Task ID in notes)
# Find task IDs with: search.sh "keyword" or search.sh --task-id "AI-..."
if [[ -z "$1" ]]; then
  echo "Usage: complete.sh <task-id>"
  echo "       complete.sh --search \"keyword\""
  echo "       complete.sh --task-id \"AI-YYYYMMDD-HHMMSS\""
  echo "Find task IDs with: search.sh \"keyword\""
  exit 1
fi

THINGS_DB="$HOME/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-BX8ZL/Things Database.thingsdatabase/main.sqlite"
AUTH_TOKEN=$(sqlite3 "$THINGS_DB" "SELECT uriSchemeAuthenticationToken FROM TMSettings LIMIT 1;" 2>/dev/null)

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "Error: Could not read auth token from Things 3 database."
  echo "Enable Things URLs in Things 3 > Settings > General."
  exit 1
fi

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
  TASK_NAME=$(sqlite3 "$THINGS_DB" "SELECT title FROM TMTask WHERE uuid = '$TASK_ID';")
  echo "Completing: $TASK_NAME"
elif [[ "$1" == "--task-id" ]]; then
  if [[ -z "$2" ]]; then
    echo "Usage: complete.sh --task-id \"AI-YYYYMMDD-HHMMSS\""
    exit 1
  fi
  TASK_ID_QUERY="%Task ID: ${2}%"
  TASK_ID=$(sqlite3 "$THINGS_DB" "
    SELECT uuid FROM TMTask
    WHERE notes LIKE '$TASK_ID_QUERY' AND trashed = 0 AND type = 0 AND status = 0
    ORDER BY creationDate DESC LIMIT 1;
  " 2>/dev/null)
  if [[ -z "$TASK_ID" ]]; then
    echo "No open task found for Task ID: $2"
    exit 1
  fi
  TASK_NAME=$(sqlite3 "$THINGS_DB" "SELECT title FROM TMTask WHERE uuid = '$TASK_ID';")
  echo "Completing by Task ID $2: $TASK_NAME"
else
  TASK_ID="$1"
  TASK_NAME=$(sqlite3 "$THINGS_DB" "SELECT title FROM TMTask WHERE uuid = '$TASK_ID';" 2>/dev/null)
  if [[ -z "$TASK_NAME" ]]; then
    echo "Task ID not found: $TASK_ID"
    exit 1
  fi
  echo "Completing: $TASK_NAME"
fi

open -g "things:///update?auth-token=${AUTH_TOKEN}&id=${TASK_ID}&completed=true"
