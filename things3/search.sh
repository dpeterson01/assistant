#!/bin/zsh
# Things 3 — Search tasks by title substring or stable task ID.
# Usage: search.sh "keyword" [--all]
#        search.sh --task-id "AI-YYYYMMDD-HHMMSS" [--all]
# Output: id | project | task name | status
# By default only shows open tasks (status=0). Use --all to include completed/canceled.
# Status: 0=open, 3=completed, 2=canceled
if [[ -z "$1" ]]; then
  echo "Usage: search.sh \"keyword\" [--all]"
  echo "       search.sh --task-id \"AI-YYYYMMDD-HHMMSS\" [--all]"
  exit 1
fi

THINGS_DB="$HOME/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-BX8ZL/Things Database.thingsdatabase/main.sqlite"
STATUS_FILTER="AND t.status = 0"
ARGS=("$@")

for arg in "${ARGS[@]}"; do
  if [[ "$arg" == "--all" ]]; then
    STATUS_FILTER=""
    break
  fi
done

if [[ "$1" == "--task-id" ]]; then
  if [[ -z "$2" ]]; then
    echo "Usage: search.sh --task-id \"AI-YYYYMMDD-HHMMSS\" [--all]"
    exit 1
  fi
  TASK_ID_QUERY="%Task ID: ${2}%"
  sqlite3 -separator ' | ' "$THINGS_DB" "
    SELECT t.uuid, COALESCE(p.title, '(inbox)'), t.title,
      CASE t.status WHEN 0 THEN 'open' WHEN 3 THEN 'completed' WHEN 2 THEN 'canceled' ELSE t.status END
    FROM TMTask t
    LEFT JOIN TMTask p ON t.project = p.uuid
    WHERE t.notes LIKE '$TASK_ID_QUERY' AND t.trashed = 0 AND t.type = 0 $STATUS_FILTER
    ORDER BY t.creationDate DESC;
  " 2>/dev/null || echo "[Things 3 database not accessible]"
  exit 0
fi

QUERY="%${1}%"
sqlite3 -separator ' | ' "$THINGS_DB" "
  SELECT t.uuid, COALESCE(p.title, '(inbox)'), t.title,
    CASE t.status WHEN 0 THEN 'open' WHEN 3 THEN 'completed' WHEN 2 THEN 'canceled' ELSE t.status END
  FROM TMTask t
  LEFT JOIN TMTask p ON t.project = p.uuid
  WHERE t.title LIKE '$QUERY' AND t.trashed = 0 AND t.type = 0 $STATUS_FILTER
  ORDER BY t.creationDate DESC;
" 2>/dev/null || echo "[Things 3 database not accessible]"
