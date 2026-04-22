#!/bin/zsh
# End-of-Day Reminder
# Triggered by launchd at 5:15 PM weekdays
# Sends a notification (end-of-day requires interactive session)

DATE=$(date +%Y-%m-%d)
LOG_DIR="$HOME/projects/personal/assistant/automation/logs"
mkdir -p "$LOG_DIR"
echo "$(date '+%Y-%m-%d %H:%M:%S') - End-of-day reminder sent" >> "$LOG_DIR/reminders-${DATE}.log"

osascript -e 'display notification "Time to run your end-of-day wrap-up. Open terminal and run: copilot --agent=end-of-day" with title "Atlas" subtitle "End of Day" sound name "Glass"'
