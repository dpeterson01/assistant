#!/usr/bin/env bash
# Archive briefings older than N days (default: 7)
# Moves both .json and .md files to briefings/archive/
# Safe to run daily via cron or manually.

set -euo pipefail

BRIEFINGS_DIR="$(cd "$(dirname "$0")/../../data/briefings" && pwd)"
ARCHIVE_DIR="$BRIEFINGS_DIR/archive"
KEEP_DAYS="${1:-7}"

mkdir -p "$ARCHIVE_DIR"

cutoff=$(date -v-"${KEEP_DAYS}"d +%Y-%m-%d 2>/dev/null || date -d "$KEEP_DAYS days ago" +%Y-%m-%d)
moved=0

for f in "$BRIEFINGS_DIR"/*_daily_brief.{json,md}; do
  [ -f "$f" ] || continue
  fname=$(basename "$f")
  file_date="${fname%%_*}"

  # Compare dates lexicographically (YYYY-MM-DD sorts correctly)
  if [[ "$file_date" < "$cutoff" ]]; then
    mv "$f" "$ARCHIVE_DIR/"
    moved=$((moved + 1))
  fi
done

echo "Archived $moved briefing files older than $KEEP_DAYS days (before $cutoff)."
