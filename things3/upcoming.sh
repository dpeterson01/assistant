#!/bin/zsh
# Things 3 — Upcoming tasks (next 7 days)
# Output: date | area > project | task name (one per line)
osascript -e '
tell application "Things3"
  set output to ""
  set upcoming to to dos of list "Upcoming"
  repeat with t in upcoming
    set tName to name of t
    set tDate to ""
    try
      set tDate to activation date of t as string
    end try
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
      set output to output & tDate & " | " & areaName & " | " & tName & linefeed
    else
      set output to output & tDate & " | " & areaName & " > " & projName & " | " & tName & linefeed
    end if
  end repeat
  return output
end tell
' 2>/dev/null || echo "[Things 3 not running or not accessible]"
