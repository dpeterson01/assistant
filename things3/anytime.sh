#!/bin/zsh
# Things 3 — Anytime tasks
# Output: area > project | task name (one per line)
osascript -e '
tell application "Things3"
  set output to ""
  set anytime to to dos of list "Anytime"
  repeat with t in anytime
    set projName to ""
    set areaName to ""
    try
      set projName to name of project of t
    on error
      set projName to ""
    end try
    try
      set areaName to name of area of t
    on error
      try
        set areaName to name of area of project of t
      on error
        set areaName to ""
      end try
    end try
    if areaName is "" then set areaName to "(inbox)"
    if projName is "" then
      set output to output & areaName & " | " & (name of t) & linefeed
    else
      set output to output & areaName & " > " & projName & " | " & (name of t) & linefeed
    end if
  end repeat
  return output
end tell
' 2>/dev/null || echo "[Things 3 not running or not accessible]"
