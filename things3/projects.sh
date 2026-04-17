#!/bin/zsh
# Things 3 — All projects with areas and task counts
# Output: area > project [status] (N tasks) (one per line)
osascript -e '
tell application "Things3"
  set output to ""
  set allProjects to every project
  repeat with p in allProjects
    set pName to name of p
    set pStatus to status of p
    set aName to ""
    try
      set aName to name of area of p
    on error
      set aName to "(no area)"
    end try
    set taskCount to count of to dos of p
    set output to output & aName & " > " & pName & " [" & pStatus & "] (" & taskCount & " tasks)" & linefeed
  end repeat
  return output
end tell
' 2>/dev/null || echo "[Things 3 not running or not accessible]"
