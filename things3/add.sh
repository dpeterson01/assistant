#!/bin/zsh
# Things 3 — Add a task with full options
# Usage: add.sh "title" [options]
# Options:
#   --notes "text"           Task notes
#   --when "YYYY-MM-DD"      When date (or "today", "tomorrow", "evening")
#   --deadline "YYYY-MM-DD"  Deadline
#   --project "name"         Add to project (within an area)
#   --area "name"            Assign to area (Work, Personal, HMBL, Church)
#   --tags "tag1,tag2"       Comma-separated tags
#   --checklist "a,b,c"      Comma-separated checklist items
#   --heading "name"         Heading within project
#   --task-id "AI-..."       Stable tracking ID (appends to notes)
if [[ -z "$1" ]]; then
  echo "Usage: add.sh \"title\" [--notes \"text\"] [--when \"YYYY-MM-DD\"] [--deadline \"YYYY-MM-DD\"] [--project \"name\"] [--area \"name\"] [--tags \"tag1,tag2\"] [--checklist \"item1,item2\"] [--heading \"name\"] [--task-id \"AI-...\"]"
  exit 1
fi

THINGS_DB="$HOME/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-BX8ZL/Things Database.thingsdatabase/main.sqlite"
AUTH_TOKEN=$(sqlite3 "$THINGS_DB" "SELECT uriSchemeAuthenticationToken FROM TMSettings LIMIT 1;" 2>/dev/null)

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "Error: Could not read auth token from Things 3 database."
  echo "Enable Things URLs in Things 3 > Settings > General."
  exit 1
fi

TITLE="$1"
shift

# URL-encode helper
urlencode() {
  python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$1"
}

URL="things:///add?auth-token=${AUTH_TOKEN}&title=$(urlencode "$TITLE")"
AREA_NAME=""
NOTES_TEXT=""
TASK_STABLE_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes) NOTES_TEXT="$2"; shift 2;;
    --when) URL+="&when=$2"; shift 2;;
    --deadline) URL+="&deadline=$2"; shift 2;;
    --project) URL+="&list=$(urlencode "$2")"; shift 2;;
    --area) AREA_NAME="$2"; shift 2;;
    --tags) URL+="&tags=$(urlencode "$2")"; shift 2;;
    --checklist)
      ITEMS=$(echo "$2" | tr ',' '\n')
      URL+="&checklist-items=$(urlencode "$ITEMS")"
      shift 2;;
    --heading) URL+="&heading=$(urlencode "$2")"; shift 2;;
    --task-id) TASK_STABLE_ID="$2"; shift 2;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done

if [[ -n "$TASK_STABLE_ID" ]]; then
  if [[ -n "$NOTES_TEXT" ]]; then
    NOTES_TEXT+=$'\n\n'
  fi
  NOTES_TEXT+="Task ID: ${TASK_STABLE_ID}"
fi

if [[ -n "$NOTES_TEXT" ]]; then
  URL+="&notes=$(urlencode "$NOTES_TEXT")"
fi

echo "Adding: $TITLE"
open -g "$URL"

# If area specified, move the task after creation (small delay for URL scheme processing)
if [[ -n "$AREA_NAME" ]]; then
  sleep 1
  TASK_ID=$(sqlite3 "$THINGS_DB" "
    SELECT uuid FROM TMTask
    WHERE title = '$(echo "$TITLE" | sed "s/'/''/g")' AND trashed = 0 AND type = 0 AND status = 0
    ORDER BY creationDate DESC LIMIT 1;
  " 2>/dev/null)
  if [[ -n "$TASK_ID" ]]; then
    osascript -e "tell application \"Things3\" to move to do id \"$TASK_ID\" to list \"$AREA_NAME\"" 2>/dev/null
    echo "  → Area: $AREA_NAME"
  fi
fi
