#!/bin/zsh
# Things 3 — Generate a stable task ID for cross-system tracking.
# Usage: new-id.sh
# Output: AI-YYYYMMDD-HHMMSS

echo "AI-$(date +%Y%m%d-%H%M%S)"
