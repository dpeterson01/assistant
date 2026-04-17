#!/bin/zsh
# Things 3 — List open to-dos that have a specific tag
# Usage: by-tag.sh <tag-name>
# Output: project | task name (one per line)
if [[ -z "$1" ]]; then
  echo "Usage: by-tag.sh <tag-name>"
  exit 1
fi

TAG="$1"

osascript <<EOF 2>/dev/null || echo "[Things 3 not running or not accessible]"
tell application "Things3"
  set output to ""
  set theTodos to to dos whose status is open
  repeat with t in theTodos
    set hasTag to false
    repeat with tg in tags of t
      if name of tg is "$TAG" then set hasTag to true
    end repeat
    if hasTag then
      set projName to ""
      try
        set projName to name of project of t
      on error
        set projName to "(inbox)"
      end try
      set output to output & projName & " | " & (name of t) & linefeed
    end if
  end repeat
  return output
end tell
EOF
