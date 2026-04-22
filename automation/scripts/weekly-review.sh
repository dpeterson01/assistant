#!/bin/zsh
# Weekly Review Reminder
# Triggered by launchd at 9:00 AM Sundays
# Sends a notification (weekly review requires interactive session)

DATE=$(date +%Y-%m-%d)
LOG_DIR="$HOME/projects/personal/assistant/automation/logs"
mkdir -p "$LOG_DIR"
echo "$(date '+%Y-%m-%d %H:%M:%S') - Weekly review reminder sent" >> "$LOG_DIR/reminders-${DATE}.log"

osascript -e 'display notification "Time for your weekly review. Open terminal and run: copilot --agent=weekly-review" with title "Atlas" subtitle "Weekly Review" sound name "Glass"'
