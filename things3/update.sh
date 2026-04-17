#!/bin/zsh
# Things 3 — Update a task by ID
# Usage: update.sh <task-id> [--title "new title"] [--notes "new notes"] [--when "YYYY-MM-DD"] [--deadline "YYYY-MM-DD"] [--complete] [--cancel]
# Find task IDs with: search.sh "keyword"
if [[ -z "$1" ]]; then
  echo "Usage: update.sh <task-id> [--title \"text\"] [--notes \"text\"] [--when \"YYYY-MM-DD\"] [--deadline \"YYYY-MM-DD\"] [--complete] [--cancel]"
  exit 1
fi

THINGS_DB="$HOME/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-BX8ZL/Things Database.thingsdatabase/main.sqlite"
AUTH_TOKEN=$(sqlite3 "$THINGS_DB" "SELECT uriSchemeAuthenticationToken FROM TMSettings LIMIT 1;" 2>/dev/null)

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "Error: Could not read auth token from Things 3 database."
  echo "Enable Things URLs in Things 3 > Settings > General."
  exit 1
fi

TASK_ID="$1"
shift

TASK_NAME=$(sqlite3 "$THINGS_DB" "SELECT title FROM TMTask WHERE uuid = '$TASK_ID';" 2>/dev/null)
if [[ -z "$TASK_NAME" ]]; then
  echo "Task ID not found: $TASK_ID"
  exit 1
fi

URL="things:///update?auth-token=${AUTH_TOKEN}&id=${TASK_ID}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)
      ENCODED=$(python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$2")
      URL+="&title=${ENCODED}"
      shift 2;;
    --notes)
      ENCODED=$(python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$2")
      URL+="&notes=${ENCODED}"
      shift 2;;
    --when) URL+="&when=$2"; shift 2;;
    --deadline) URL+="&deadline=$2"; shift 2;;
    --complete) URL+="&completed=true"; shift;;
    --cancel) URL+="&canceled=true"; shift;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done

echo "Updating: $TASK_NAME"
open -g "$URL"
