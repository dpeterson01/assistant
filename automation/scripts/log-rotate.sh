#!/bin/zsh
# Atlas Log Rotation
# Removes dated log files older than N days. Keeps launchd capture logs (not dated).
# Usage: ./log-rotate.sh [--days N] [--dry-run]
#
# Designed to be called from launchd or manually.

set -uo pipefail
setopt NULL_GLOB  # globs that match nothing expand to empty

KEEP_DAYS=14
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --days)   KEEP_DAYS="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        *)        echo "Usage: $0 [--days N] [--dry-run]"; exit 1 ;;
    esac
done

# All log directories to rotate
LOG_DIRS=(
    "$HOME/projects/personal/assistant/automation/logs"
    "$HOME/.local/share/daily-consolidation"
    "$HOME/.local/share/dashboard"
    "$HOME/.local/share/outlook-mcp/logs"
    "$HOME/.local/share/pod-assignments"
)

CUTOFF=$(date -v-${KEEP_DAYS}d +%Y-%m-%d)
REMOVED=0
FREED=0

echo "Log rotation: keeping ${KEEP_DAYS} days (cutoff: ${CUTOFF})"
echo ""

for dir in "${LOG_DIRS[@]}"; do
    [[ -d "$dir" ]] || continue

    # Dated log files: *-YYYY-MM-DD.log and sentinel files
    for f in "$dir"/*-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].log "$dir"/*-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].sentinel; do
        [[ -f "$f" ]] || continue
        fname=$(basename "$f")
        # Extract date from filename
        if [[ "$fname" =~ ([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
            file_date="${match[1]}"
            if [[ "$file_date" < "$CUTOFF" ]]; then
                size=$(stat -f '%z' "$f")
                if $DRY_RUN; then
                    echo "  [dry-run] would remove: $f ($(( size / 1024 ))KB)"
                else
                    rm "$f"
                    echo "  removed: $f ($(( size / 1024 ))KB)"
                fi
                REMOVED=$((REMOVED + 1))
                FREED=$((FREED + size))
            fi
        fi
    done

    # Truncate non-dated (append-only) launchd logs over 1MB
    for f in "$dir"/launchd-*.log "$dir"/*-launchd.log; do
        [[ -f "$f" ]] || continue
        size=$(stat -f '%z' "$f")
        if (( size > 1048576 )); then
            if $DRY_RUN; then
                echo "  [dry-run] would truncate: $f ($(( size / 1024 ))KB -> keep last 100KB)"
            else
                tail -c 102400 "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"
                echo "  truncated: $f ($(( size / 1024 ))KB -> 100KB)"
            fi
            FREED=$((FREED + size - 102400))
            REMOVED=$((REMOVED + 1))
        fi
    done
done

echo ""
echo "Done: ${REMOVED} files processed, $(( FREED / 1024 ))KB freed"
