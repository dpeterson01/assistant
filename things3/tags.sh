#!/bin/zsh
# Things 3 — List tags on a task, or list all tags
# Usage: tags.sh                    (list all tags)
#        tags.sh <task-id>          (list tags on a task)
#        tags.sh --search "keyword" (list tags on first matching task)
THINGS_DB="$HOME/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-BX8ZL/Things Database.thingsdatabase/main.sqlite"

if [[ -z "$1" ]]; then
  # List all tags with task counts
  sqlite3 -separator ' | ' "$THINGS_DB" "
    SELECT tag.title,
      (SELECT count(*) FROM TMTaskTag tt
       JOIN TMTask t ON tt.tasks = t.uuid
       WHERE tt.tags = tag.uuid AND t.trashed = 0 AND t.status = 0) as open_tasks
    FROM TMTag tag
    ORDER BY tag.title;
  "
  exit 0
fi

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

echo "Tags for: $TASK_NAME"
sqlite3 "$THINGS_DB" "
  SELECT '  - ' || tag.title
  FROM TMTaskTag tt
  JOIN TMTag tag ON tt.tags = tag.uuid
  WHERE tt.tasks = '$TASK_ID';
"
