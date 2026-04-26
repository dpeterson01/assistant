#!/bin/zsh
# check-briefing-sync.sh
# Manually trigger immediate sync of checked briefing items to Things 3 and action tracking
# Called by /check-briefing agent prompt

set -e

ASSISTANT_DIR="$HOME/projects/personal/assistant"
BRIEFING_DIR="$ASSISTANT_DIR/data/briefings"
ACTION_ITEMS="$ASSISTANT_DIR/data/context/action-items.md"
CHECKPOINT_HELPER="$ASSISTANT_DIR/automation/checkpoint-helper.py"
ATLAS="python3 $ASSISTANT_DIR/scripts/atlas-db.py"

# Determine today's briefing file
TODAY=$(date +%Y-%m-%d)
BRIEFING_FILE="$BRIEFING_DIR/${TODAY}_daily_brief.md"

if [[ ! -f "$BRIEFING_FILE" ]]; then
  echo "Error: Today's briefing not found at $BRIEFING_FILE"
  echo "Create one first with /morning-briefing"
  exit 1
fi

echo "Running checkpoint sync for $TODAY..."
echo ""

# Step 1: Run checkpoint compare to detect newly-checked items
# Call checkpoint-helper.py with compare mode to detect checkbox state changes
COMPARE_OUTPUT=$(python3 "$ASSISTANT_DIR/automation/checkpoint-helper.py" compare "$BRIEFING_FILE" 2>&1)

if echo "$COMPARE_OUTPUT" | grep -q "newly_checked"; then
  # Extract newly-checked items from JSON
  NEWLY_CHECKED=$(echo "$COMPARE_OUTPUT" | grep -A 1000 '"newly_checked"' | grep '"text"' | sed 's/.*"text": "\(.*\)".*/\1/')
else
  NEWLY_CHECKED=""
fi

# Count items
ITEM_COUNT=$(echo "$NEWLY_CHECKED" | grep -c . || echo 0)

if [[ $ITEM_COUNT -eq 0 ]]; then
  echo "✓ No newly-checked items to process"
  echo ""
  
  # Still save state to prevent stale comparisons
  python3 "$CHECKPOINT_HELPER" save-state "$BRIEFING_FILE" "$TODAY" 2>/dev/null
  echo "✓ Checkpoint state saved"
  exit 0
fi

echo "Processing $ITEM_COUNT newly-checked items..."
echo ""

# Step 2: Process each newly-checked item
COMPLETED_COUNT=0
FAILED_COUNT=0

while IFS= read -r ITEM_TEXT; do
  [[ -z "$ITEM_TEXT" ]] && continue
  
  # Extract Task ID from item text (format: "... (Task ID: AI-YYYYMMDD-HHMMSS)" or "... Task ID: AI-...")
  TASK_ID=$(echo "$ITEM_TEXT" | grep -oP 'Task ID: \K(AI-[0-9]{8}-[0-9]{6})')
  
  if [[ -n "$TASK_ID" ]]; then
    # Complete via atlas-db (auto-pushes to Things 3 and re-renders markdown)
    if $ATLAS commit complete --task-id "$TASK_ID" >/dev/null 2>&1; then
      echo "  ✓ $ITEM_TEXT"
      ((COMPLETED_COUNT++))
    else
      echo "  ⚠ $ITEM_TEXT (Things 3 task not found)"
      ((FAILED_COUNT++))
    fi
  else
    echo "  ⚠ $ITEM_TEXT (no Task ID embedded)"
    ((FAILED_COUNT++))
  fi
done <<< "$NEWLY_CHECKED"

echo ""
echo "✓ Sync Complete"
echo "  Completed: $COMPLETED_COUNT items"
[[ $FAILED_COUNT -gt 0 ]] && echo "  Warnings: $FAILED_COUNT items"

# Step 3: Save new checkpoint state to prevent duplicate processing
# Call checkpoint-helper.py with save-state mode to record current checkbox state
python3 "$ASSISTANT_DIR/automation/checkpoint-helper.py" save-state "$BRIEFING_FILE" "$TODAY" 2>/dev/null

echo "  State saved for next sync"
