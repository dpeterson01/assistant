#!/usr/bin/env python3
"""
Briefing checkpoint helper for detecting and processing checkbox state changes.
Parses Markdown briefing files and compares against last-known state.

Usage:
  checkpoint-helper.py read <briefing_file>           # Extract current checkbox state
  checkpoint-helper.py compare <briefing_file>        # Compare vs last state, emit delta
  checkpoint-helper.py save-state <briefing_file>     # Store current state
"""

import sys
import json
import re
from pathlib import Path
from datetime import datetime

CHECKPOINT_DIR = Path.home() / "projects/personal/assistant/automation/.checkpoints"

def extract_checkboxes(filepath):
    """Parse a Markdown briefing and extract all checkboxes with their text and state."""
    checkboxes = []
    with open(filepath, 'r') as f:
        lines = f.readlines()
    
    for i, line in enumerate(lines):
        # Match checkbox pattern: - [x] or - [ ] followed by text
        match = re.match(r'^\s*- \[([ xX])\]\s+(.+)$', line)
        if match:
            checked = match.group(1).lower() == 'x'
            text = match.group(2).strip()
            # Use text as stable identifier (strip Task IDs for matching)
            key = re.sub(r'\s+\(Task ID: [^)]+\)', '', text)
            checkboxes.append({
                'text': text,
                'key': key,
                'checked': checked,
                'line': i + 1  # 1-indexed for reporting
            })
    
    return checkboxes

def load_state(checkpoint_id):
    """Load the last-known checkpoint state for a briefing."""
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    state_file = CHECKPOINT_DIR / f"{checkpoint_id}.json"
    if state_file.exists():
        with open(state_file, 'r') as f:
            return json.load(f)
    return {'checkboxes': [], 'last_sync': None}

def save_state(checkpoint_id, briefing_file):
    """Save the current checkbox state to checkpoint storage."""
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    checkboxes = extract_checkboxes(briefing_file)
    state = {
        'checkboxes': [{'key': cb['key'], 'checked': cb['checked']} for cb in checkboxes],
        'last_sync': datetime.now().isoformat(),
        'briefing_file': str(briefing_file)
    }
    state_file = CHECKPOINT_DIR / f"{checkpoint_id}.json"
    with open(state_file, 'w') as f:
        json.dump(state, f, indent=2)
    print(f"State saved to {state_file}")

def compare_state(checkpoint_id, briefing_file):
    """Compare current briefing state against last checkpoint. Emit newly-checked items."""
    current = extract_checkboxes(briefing_file)
    last = load_state(checkpoint_id)
    
    # Build key->checked map for last state
    last_map = {cb['key']: cb['checked'] for cb in last.get('checkboxes', [])}
    
    # Find newly checked items (was unchecked, now checked)
    newly_checked = []
    for cb in current:
        was_checked = last_map.get(cb['key'], False)
        is_checked = cb['checked']
        if not was_checked and is_checked:
            newly_checked.append(cb)
    
    return {
        'newly_checked': newly_checked,
        'total_checked': sum(1 for cb in current if cb['checked']),
        'total_checkboxes': len(current),
        'last_sync': last.get('last_sync'),
        'current_checkboxes': current
    }

def main():
    if len(sys.argv) < 3:
        print("Usage: checkpoint-helper.py [read|compare|save-state] <briefing_file> [checkpoint_id]")
        sys.exit(1)
    
    command = sys.argv[1]
    briefing_file = Path(sys.argv[2])
    
    # Extract checkpoint ID from filename (YYYY-MM-DD_daily_brief.md -> YYYY-MM-DD)
    checkpoint_id = sys.argv[3] if len(sys.argv) > 3 else briefing_file.stem.split('_')[0]
    
    if not briefing_file.exists():
        print(f"Error: File not found: {briefing_file}")
        sys.exit(1)
    
    if command == 'read':
        checkboxes = extract_checkboxes(briefing_file)
        print(json.dumps([{'text': cb['text'], 'checked': cb['checked'], 'line': cb['line']} for cb in checkboxes], indent=2))
    
    elif command == 'compare':
        result = compare_state(checkpoint_id, briefing_file)
        print(f"Newly checked: {len(result['newly_checked'])}/{result['total_checkboxes']} items")
        if result['newly_checked']:
            print("\nItems to close:")
            for cb in result['newly_checked']:
                print(f"  - {cb['text']}")
        print(f"\nLast sync: {result['last_sync'] or 'never'}")
        print(json.dumps({'newly_checked': result['newly_checked']}, indent=2))
    
    elif command == 'save-state':
        save_state(checkpoint_id, briefing_file)
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)

if __name__ == '__main__':
    main()
