#!/bin/zsh
# setup-wake-schedule.sh
# One-time setup: configures macOS pmset to wake the Mac before scheduled jobs.
# Run once with: sudo zsh setup-wake-schedule.sh
#
# What this does:
#   - Wakes at 6:25 AM Mon-Fri (5 min before morning briefing at 6:30 AM)
#   - Wakes at 7:55 PM Mon-Fri (5 min before end-of-day auto-run at 8:00 PM)
#   - No separate midday wake — RunAtLoad handles midday sync on next login if missed.
#
# Limitations:
#   - Only reliable on AC power. On battery, macOS may skip the wake to save charge.
#   - Does NOT unlock the screen — launchd fires jobs in your session context
#     regardless of whether the screen is locked.
#   - pmset repeat only supports ONE repeating schedule at a time.
#     This script uses a LaunchDaemon approach to schedule both wake times.

if [[ $EUID -ne 0 ]]; then
  echo "Error: This script must be run with sudo."
  echo "Usage: sudo zsh $(basename $0)"
  exit 1
fi

echo "Setting pmset wake schedules..."

# pmset repeat only supports one schedule, so we use the morning one as the primary
# and install a second LaunchDaemon to trigger the evening wake via pmset schedule.

# Morning: Wake Mon-Fri at 6:25 AM (5 min before morning briefing)
pmset repeat wakeorpoweron MTWRF 06:25:00
echo "✓ Morning wake set: Mon-Fri 6:25 AM"

# Evening: Install a daily LaunchDaemon that reschedules a 7:55 PM wake each morning.
# This daemon runs as root at 6:20 AM and schedules that night's pmset wake.
DAEMON_PLIST="/Library/LaunchDaemons/com.atlas.evening-wake-scheduler.plist"

cat > "$DAEMON_PLIST" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.atlas.evening-wake-scheduler</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>-c</string>
        <string>pmset schedule wake "$(date '+%m/%d/%Y') 19:55:00"</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>6</integer><key>Minute</key><integer>20</integer></dict>
        <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>6</integer><key>Minute</key><integer>20</integer></dict>
        <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>6</integer><key>Minute</key><integer>20</integer></dict>
        <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>6</integer><key>Minute</key><integer>20</integer></dict>
        <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>6</integer><key>Minute</key><integer>20</integer></dict>
    </array>
    <key>Disabled</key>
    <false/>
</dict>
</plist>
PLIST

launchctl load "$DAEMON_PLIST" 2>/dev/null || launchctl unload "$DAEMON_PLIST" && launchctl load "$DAEMON_PLIST"
echo "✓ Evening wake daemon installed: schedules 7:55 PM wake each weekday morning"

echo ""
echo "Current schedule:"
pmset -g sched | grep -v "user-invisible" | head -10

echo ""
echo "Done."
echo "  Morning: Mac wakes Mon-Fri at 6:25 AM → briefing runs at 6:30 AM"
echo "  Evening: Mac wakes Mon-Fri at 7:55 PM → end-of-day runs at 8:00 PM"
echo ""
echo "Notes:"
echo "  - Only works reliably on AC power"
echo "  - To remove morning: sudo pmset repeat cancel"
echo "  - To remove evening daemon: sudo launchctl unload /Library/LaunchDaemons/com.atlas.evening-wake-scheduler.plist && sudo rm /Library/LaunchDaemons/com.atlas.evening-wake-scheduler.plist"
echo "  - To check: pmset -g sched"
