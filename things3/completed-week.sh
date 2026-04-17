#!/bin/zsh
# Things 3 — Tasks completed in the last 7 days
# Output: project | task name (one per line)
osascript -e '
tell application "Things3"
  set output to ""
  set logbook to to dos of list "Logbook"
  set weekAgo to (current date) - 7 * days
  set itemCount to 0
  repeat with t in logbook
    if itemCount > 500 then exit repeat
    try
      set compDate to completion date of t
      if compDate > weekAgo then
        set projName to ""
        try
          set projName to name of project of t
        on error
          set projName to "(inbox)"
        end try
        set output to output & projName & " | " & (name of t) & linefeed
      end if
    end try
    set itemCount to itemCount + 1
  end repeat
  return output
end tell
' 2>/dev/null || echo "[Things 3 not running or not accessible]"
