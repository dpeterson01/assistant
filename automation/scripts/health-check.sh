#!/bin/zsh
# Atlas Automation Health Check
# Scans all scheduled jobs: timing, frequency, last successful run, current status.
# Usage: ./health-check.sh [--json]

set -uo pipefail

LOGS="$HOME/projects/personal/assistant/automation/logs"
TODAY=$(date +%Y-%m-%d)
NOW_EPOCH=$(date +%s)

# --- Color codes (disabled if piped) ---
if [[ -t 1 ]]; then
    GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; DIM='\033[0;90m'; RESET='\033[0m'; BOLD='\033[1m'
else
    GREEN=''; RED=''; YELLOW=''; DIM=''; RESET=''; BOLD=''
fi

JSON_MODE=false
[[ "${1:-}" == "--json" ]] && JSON_MODE=true

# --- Helper: find newest log matching a glob, extract last timestamp ---
last_log_date() {
    local pattern="$1"
    local newest
    newest=$(ls -t $pattern 2>/dev/null | head -1)
    if [[ -z "$newest" ]]; then
        echo "never"
        return
    fi
    # Extract date from filename (pattern: *-YYYY-MM-DD.log)
    local fname=$(basename "$newest")
    if [[ "$fname" =~ ([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
        echo "${match[1]}"
    else
        # Fall back to file modification date
        stat -f '%Sm' -t '%Y-%m-%d' "$newest"
    fi
}

# --- Helper: check if a dated log has success markers ---
check_success() {
    local log_file="$1"
    local success_pattern="$2"
    if [[ ! -f "$log_file" ]]; then
        echo "no-log"
        return
    fi
    if grep -q "$success_pattern" "$log_file" 2>/dev/null; then
        echo "ok"
    elif grep -qi "error\|traceback\|fatal\|failed" "$log_file" 2>/dev/null; then
        echo "error"
    else
        echo "ran"
    fi
}

# --- Helper: find last date a job ran successfully ---
last_success() {
    local prefix="$1"
    local log_dir="$2"
    local success_pattern="$3"
    local days_back="${4:-14}"

    for i in $(seq 0 $days_back); do
        local check_date=$(date -v-${i}d +%Y-%m-%d)
        local log_file="${log_dir}/${prefix}-${check_date}.log"
        if [[ -f "$log_file" ]] && grep -q "$success_pattern" "$log_file" 2>/dev/null; then
            echo "$check_date"
            return
        fi
    done
    echo "none (${days_back}d)"
}

# --- Helper: last success for non-dated logs (single log file) ---
last_success_single() {
    local log_file="$1"
    local success_pattern="$2"
    if [[ ! -f "$log_file" ]]; then
        echo "never"
        return
    fi
    # Get the last line matching the success pattern and extract its timestamp
    local last_line
    last_line=$(grep "$success_pattern" "$log_file" 2>/dev/null | tail -1)
    if [[ -z "$last_line" ]]; then
        echo "never"
        return
    fi
    # Try to extract a date from the line
    if [[ "$last_line" =~ ([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
        echo "${match[1]}"
    else
        # Fall back to file mod date
        stat -f '%Sm' -t '%Y-%m-%d' "$log_file"
    fi
}

# --- Helper: days ago text ---
days_ago() {
    local date_str="$1"
    if [[ "$date_str" == "never" || "$date_str" == none* ]]; then
        echo "$date_str"
        return
    fi
    local target_epoch=$(date -j -f '%Y-%m-%d' "$date_str" +%s 2>/dev/null)
    if [[ -z "$target_epoch" ]]; then
        echo "$date_str"
        return
    fi
    local diff=$(( (NOW_EPOCH - target_epoch) / 86400 ))
    if (( diff == 0 )); then
        echo "today"
    elif (( diff == 1 )); then
        echo "yesterday"
    else
        echo "${diff}d ago"
    fi
}

# --- Helper: status icon ---
status_icon() {
    local st="$1"
    case "$st" in
        ok)      echo "${GREEN}OK${RESET}" ;;
        ran)     echo "${YELLOW}RAN${RESET}" ;;
        error)   echo "${RED}ERR${RESET}" ;;
        no-log)  echo "${DIM}---${RESET}" ;;
        *)       echo "${DIM}?${RESET}" ;;
    esac
}

# ============================================================
# Job definitions: name, schedule, frequency, log detection
# ============================================================

declare -a JOB_NAMES JOB_SCHEDULES JOB_FREQUENCIES JOB_LAST_SUCCESS JOB_TODAY_STATUS

# 1. Morning Briefing
JOB_NAMES+=("Morning Briefing")
JOB_SCHEDULES+=("6:30 AM M-F, 7:30 AM Sat-Sun")
JOB_FREQUENCIES+=("Daily")
JOB_LAST_SUCCESS+=("$(last_success "morning-briefing" "$LOGS" "=== Finished")")
JOB_TODAY_STATUS+=("$(check_success "$LOGS/morning-briefing-${TODAY}.log" "=== Finished")")

# 2. Briefing Sync
JOB_NAMES+=("Briefing Sync")
JOB_SCHEDULES+=("Every 15 min")
JOB_FREQUENCIES+=("96x/day")
JOB_LAST_SUCCESS+=("$(last_success "briefing-sync" "$LOGS" "=== Briefing Sync")")
JOB_TODAY_STATUS+=("$(check_success "$LOGS/briefing-sync-${TODAY}.log" "=== Briefing Sync")")

# 3. Meeting Sweep
JOB_NAMES+=("Meeting Sweep")
JOB_SCHEDULES+=("Every 15 min")
JOB_FREQUENCIES+=("96x/day")
JOB_LAST_SUCCESS+=("$(last_success "meeting-sweep" "$LOGS" "=== Meeting Sweep")")
JOB_TODAY_STATUS+=("$(check_success "$LOGS/meeting-sweep-${TODAY}.log" "=== Meeting Sweep")")

# 4. Meeting Recap Sweep
JOB_NAMES+=("Meeting Recap Sweep")
JOB_SCHEDULES+=("Every 15 min")
JOB_FREQUENCIES+=("96x/day")
JOB_LAST_SUCCESS+=("$(last_success "meeting-recap-sweep" "$LOGS" "=== Meeting Recap Sweep")")
JOB_TODAY_STATUS+=("$(check_success "$LOGS/meeting-recap-sweep-${TODAY}.log" "=== Meeting Recap Sweep")")

# 5. EOD Reminder
JOB_NAMES+=("EOD Reminder")
JOB_SCHEDULES+=("5:15 PM M-F")
JOB_FREQUENCIES+=("Weekdays")
JOB_LAST_SUCCESS+=("$(last_success "reminders" "$LOGS" "End-of-day reminder")")
JOB_TODAY_STATUS+=("$(check_success "$LOGS/reminders-${TODAY}.log" "End-of-day reminder")")

# 6. End-of-Day Auto
JOB_NAMES+=("End-of-Day Auto")
JOB_SCHEDULES+=("8/9/10 PM M-F (retry)")
JOB_FREQUENCIES+=("Weekdays")
# EOD success = sentinel file exists
eod_last="none (14d)"
for i in $(seq 0 14); do
    check_date=$(date -v-${i}d +%Y-%m-%d)
    if [[ -f "$LOGS/eod-complete-${check_date}.sentinel" ]]; then
        eod_last="$check_date"
        break
    fi
done
JOB_LAST_SUCCESS+=("$eod_last")
if [[ -f "$LOGS/eod-complete-${TODAY}.sentinel" ]]; then
    JOB_TODAY_STATUS+=("ok")
else
    JOB_TODAY_STATUS+=("$(check_success "$LOGS/end-of-day-auto-${TODAY}.log" "sentinel")")
fi

# 7. Weekly Review
JOB_NAMES+=("Weekly Review")
JOB_SCHEDULES+=("9:00 AM Sun")
JOB_FREQUENCIES+=("Weekly")
JOB_LAST_SUCCESS+=("$(last_success "reminders" "$LOGS" "Weekly review reminder")")
JOB_TODAY_STATUS+=("$(check_success "$LOGS/reminders-${TODAY}.log" "Weekly review")")

# 8. Dashboard Server
JOB_NAMES+=("Dashboard Server")
JOB_SCHEDULES+=("Always (KeepAlive)")
JOB_FREQUENCIES+=("Persistent")
# Check if dashboard is responding
if curl -s -o /dev/null -w '%{http_code}' http://localhost:3141/ 2>/dev/null | grep -q 200; then
    JOB_LAST_SUCCESS+=("$TODAY")
    JOB_TODAY_STATUS+=("ok")
else
    JOB_LAST_SUCCESS+=("$(stat -f '%Sm' -t '%Y-%m-%d' "$LOGS/dashboard.log" 2>/dev/null || echo 'never')")
    JOB_TODAY_STATUS+=("error")
fi

# 9. Dashboard Refresh
JOB_NAMES+=("Dashboard Refresh")
JOB_SCHEDULES+=("Hourly 6AM-10PM")
JOB_FREQUENCIES+=("17x/day")
DASH_LOG="$HOME/.local/share/dashboard/refresh.log"
JOB_LAST_SUCCESS+=("$(last_success_single "$DASH_LOG" "refreshed:")")
if [[ -f "$DASH_LOG" ]] && grep -q "$(date +%Y-%m-%d)" "$DASH_LOG" 2>/dev/null; then
    JOB_TODAY_STATUS+=("ok")
else
    # Check stderr for errors
    DASH_ERR="$HOME/.local/share/dashboard/stderr.log"
    if [[ -f "$DASH_ERR" ]] && tail -1 "$DASH_ERR" 2>/dev/null | grep -q "$(date +%Y-%m-%d)"; then
        JOB_TODAY_STATUS+=("error")
    else
        JOB_TODAY_STATUS+=("no-log")
    fi
fi

# 10. Daily Consolidation
JOB_NAMES+=("Daily Consolidation")
JOB_SCHEDULES+=("8:00 PM daily")
JOB_FREQUENCIES+=("Daily")
CONSOL_LOG="$HOME/.local/share/daily-consolidation/consolidation.log"
JOB_LAST_SUCCESS+=("$(last_success_single "$CONSOL_LOG" "consolidation complete")")
if [[ -f "$CONSOL_LOG" ]] && grep -q "${TODAY}.*consolidation complete" "$CONSOL_LOG" 2>/dev/null; then
    JOB_TODAY_STATUS+=("ok")
elif [[ -f "$CONSOL_LOG" ]] && grep -q "$TODAY" "$CONSOL_LOG" 2>/dev/null; then
    JOB_TODAY_STATUS+=("ran")
else
    JOB_TODAY_STATUS+=("no-log")
fi

# 11. Email Cleanup
JOB_NAMES+=("Email Cleanup")
JOB_SCHEDULES+=("6AM / 12PM / 8PM")
JOB_FREQUENCIES+=("3x/day")
CLEANUP_LOG="$HOME/.local/share/outlook-mcp/logs/cleanup.log"
JOB_LAST_SUCCESS+=("$(last_success_single "$CLEANUP_LOG" "cleanup complete")")
if [[ -f "$CLEANUP_LOG" ]] && grep -q "${TODAY}.*cleanup complete" "$CLEANUP_LOG" 2>/dev/null; then
    JOB_TODAY_STATUS+=("ok")
elif [[ -f "$CLEANUP_LOG" ]] && grep -q "$TODAY" "$CLEANUP_LOG" 2>/dev/null; then
    JOB_TODAY_STATUS+=("ran")
else
    JOB_TODAY_STATUS+=("no-log")
fi

# 12. Pod Assignments
JOB_NAMES+=("Pod Assignments")
JOB_SCHEDULES+=("10:00 AM M-F")
JOB_FREQUENCIES+=("Weekdays")
POD_LOG="$HOME/.local/share/pod-assignments/refresh.log"
POD_MARKER="$HOME/.local/share/pod-assignments/needs-mcp-refresh"
JOB_LAST_SUCCESS+=("$(last_success_single "$POD_LOG" "refresh starting")")
if [[ -f "$POD_MARKER" ]]; then
    # PAT expired/missing, script wrote a fallback marker
    JOB_TODAY_STATUS+=("pat-expired")
elif [[ -f "$POD_LOG" ]] && grep -q "$TODAY" "$POD_LOG" 2>/dev/null; then
    # Check stderr for errors
    POD_ERR="$HOME/.local/share/pod-assignments/launchd-stderr.log"
    if [[ -f "$POD_ERR" ]] && [[ -s "$POD_ERR" ]] && tail -5 "$POD_ERR" 2>/dev/null | grep -qi "error\|traceback"; then
        JOB_TODAY_STATUS+=("error")
    else
        JOB_TODAY_STATUS+=("ok")
    fi
else
    JOB_TODAY_STATUS+=("no-log")
fi

# ============================================================
# Output
# ============================================================

if $JSON_MODE; then
    echo "["
    for i in $(seq 1 ${#JOB_NAMES}); do
        [[ $i -gt 1 ]] && echo ","
        printf '  {"name": "%s", "schedule": "%s", "frequency": "%s", "last_success": "%s", "today": "%s"}' \
            "${JOB_NAMES[$i]}" "${JOB_SCHEDULES[$i]}" "${JOB_FREQUENCIES[$i]}" "${JOB_LAST_SUCCESS[$i]}" "${JOB_TODAY_STATUS[$i]}"
    done
    echo ""
    echo "]"
    exit 0
fi

# Table output
echo ""
echo "${BOLD}Atlas Automation Health Check${RESET}  ($(date '+%Y-%m-%d %H:%M'))  "
echo ""

# Header
printf "  ${BOLD}%-22s  %-27s  %-10s  %-14s  %-6s${RESET}\n" \
    "Job" "Schedule" "Frequency" "Last Success" "Today"
printf "  %-22s  %-27s  %-10s  %-14s  %-6s\n" \
    "$(printf '%0.s-' {1..22})" "$(printf '%0.s-' {1..27})" "$(printf '%0.s-' {1..10})" "$(printf '%0.s-' {1..14})" "$(printf '%0.s-' {1..6})"

for i in $(seq 1 ${#JOB_NAMES}); do
    local_st="${JOB_TODAY_STATUS[$i]}"
    local_last="${JOB_LAST_SUCCESS[$i]}"
    local_ago="$(days_ago "$local_last")"

    printf "  %-22s  %-27s  %-10s  %-14s  %b\n" \
        "${JOB_NAMES[$i]}" "${JOB_SCHEDULES[$i]}" "${JOB_FREQUENCIES[$i]}" "$local_ago" "$(status_icon "$local_st")"
done

echo ""

# Summary
ok_count=0; err_count=0; nolog_count=0
for st in "${JOB_TODAY_STATUS[@]}"; do
    case "$st" in
        ok)     ok_count=$((ok_count + 1)) ;;
        error)  err_count=$((err_count + 1)) ;;
        no-log) nolog_count=$((nolog_count + 1)) ;;
    esac
done

echo "  ${GREEN}${ok_count} healthy${RESET}  ${RED}${err_count} errors${RESET}  ${DIM}${nolog_count} not yet run${RESET}"
echo ""
