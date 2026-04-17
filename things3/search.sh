#!/bin/zsh
# Things 3 — Search tasks by name (case-insensitive substring match)
# Usage: search.sh "keyword" [--all]
# Output: id | project | task name | status
# By default only shows open tasks (status=0). Use --all to include completed/canceled.
# Status: 0=open, 3=completed, 2=canceled
if [[ -z "$1" ]]; then
  echo "Usage: search.sh \"keyword\" [--all]"
  exit 1
fi

THINGS_DB="$HOME/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-BX8ZL/Things Database.thingsdatabase/main.sqlite"
QUERY="%${1}%"
STATUS_FILTER="AND t.status = 0"
[[ "$2" == "--all" ]] && STATUS_FILTER=""

sqlite3 -separator ' | ' "$THINGS_DB" "
  SELECT t.uuid, COALESCE(p.title, '(inbox)'), t.title,
    CASE t.status WHEN 0 THEN 'open' WHEN 3 THEN 'completed' WHEN 2 THEN 'canceled' ELSE t.status END
  FROM TMTask t
  LEFT JOIN TMTask p ON t.project = p.uuid
  WHERE t.title LIKE '$QUERY' AND t.trashed = 0 AND t.type = 0 $STATUS_FILTER
  ORDER BY t.creationDate DESC;
" 2>/dev/null || echo "[Things 3 database not accessible]"
