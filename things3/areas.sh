#!/bin/zsh
# Things 3 — List areas with their projects
# Usage: areas.sh
THINGS_DB="$HOME/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-BX8ZL/Things Database.thingsdatabase/main.sqlite"

echo "=== Areas & Projects ==="
sqlite3 "$THINGS_DB" "
  SELECT '## ' || a.title
  FROM TMArea a
  ORDER BY a.title;
" 2>/dev/null | while IFS= read -r area; do
  AREA_TITLE="${area#\#\# }"
  echo ""
  echo "$area"
  sqlite3 "$THINGS_DB" "
    SELECT '  - ' || t.title || ' (' || t.openUntrashedLeafActionsCount || ' open)'
    FROM TMTask t
    JOIN TMArea a ON t.area = a.uuid
    WHERE t.type = 1 AND t.trashed = 0 AND t.status = 0 AND a.title = '$AREA_TITLE'
    ORDER BY t.title;
  "
done

# Projects without an area
echo ""
echo "## (No Area)"
sqlite3 "$THINGS_DB" "
  SELECT '  - ' || t.title || ' (' || t.openUntrashedLeafActionsCount || ' open)'
  FROM TMTask t
  WHERE t.type = 1 AND t.trashed = 0 AND t.status = 0 AND (t.area IS NULL OR t.area = '')
  ORDER BY t.title;
"
