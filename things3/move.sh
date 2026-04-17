#!/bin/zsh
# Things 3 — Move a task to a project
# Usage: move.sh <task-id> <project-name>
#        move.sh --search "task keyword" "project name"
# Find task IDs with: search.sh "keyword"
# List projects with: projects.sh
if [[ -z "$1" || -z "$2" ]]; then
  echo "Usage: move.sh <task-id> \"project name\""
  echo "       move.sh --search \"task keyword\" \"project name\""
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
  PROJECT_NAME="$3"
else
  TASK_ID="$1"
  PROJECT_NAME="$2"
fi

TASK_NAME=$(sqlite3 "$THINGS_DB" "SELECT title FROM TMTask WHERE uuid = '$TASK_ID';" 2>/dev/null)
if [[ -z "$TASK_NAME" ]]; then
  echo "Task ID not found: $TASK_ID"
  exit 1
fi

# Verify project exists
PROJECT_EXISTS=$(sqlite3 "$THINGS_DB" "
  SELECT title FROM TMTask
  WHERE type = 1 AND trashed = 0 AND status = 0 AND title = '$PROJECT_NAME'
  LIMIT 1;
" 2>/dev/null)

if [[ -z "$PROJECT_EXISTS" ]]; then
  echo "Project not found: $PROJECT_NAME"
  echo "Available projects:"
  sqlite3 "$THINGS_DB" "SELECT '  - ' || title FROM TMTask WHERE type = 1 AND trashed = 0 AND status = 0 ORDER BY title;"
  exit 1
fi

echo "Moving \"$TASK_NAME\" → $PROJECT_NAME"
osascript -e "
tell application \"Things3\"
  set t to to do id \"$TASK_ID\"
  set project of t to project \"$PROJECT_NAME\"
end tell
"
