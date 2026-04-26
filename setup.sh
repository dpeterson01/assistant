#!/usr/bin/env bash
# Atlas Assistant Setup
# Creates the data/ directory structure for personal data.
# Run this after cloning the repo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSISTANT_DIR="$SCRIPT_DIR"
DATA_DIR="$ASSISTANT_DIR/data"

echo "Atlas Assistant Setup"
echo "====================="
echo ""

# Check if data/ already exists (symlink or directory)
if [[ -e "$DATA_DIR" ]]; then
  echo "data/ already exists. Nothing to do."
  echo "  Location: $(readlink -f "$DATA_DIR" 2>/dev/null || echo "$DATA_DIR")"
  exit 0
fi

echo "The assistant stores personal data (briefings, action items, identity)"
echo "in a 'data/' directory. This directory is gitignored so your personal"
echo "data never reaches GitHub."
echo ""
echo "Options:"
echo "  1) Create data/ as a local directory (simple, no cloud backup)"
echo "  2) Create data/ as a symlink to an iCloud directory (cloud-synced)"
echo "  3) Create data/ as a symlink to a custom path"
echo ""

read -rp "Choose [1/2/3]: " choice

case "$choice" in
  1)
    mkdir -p "$DATA_DIR"
    echo "Created local data/ directory."
    ;;
  2)
    ICLOUD_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/personal/atlas-data"
    mkdir -p "$ICLOUD_DIR"
    ln -s "$ICLOUD_DIR" "$DATA_DIR"
    echo "Created iCloud-synced data/ directory at:"
    echo "  $ICLOUD_DIR"
    ;;
  3)
    read -rp "Enter the full path for your data directory: " custom_path
    custom_path="${custom_path/#\~/$HOME}"
    mkdir -p "$custom_path"
    ln -s "$custom_path" "$DATA_DIR"
    echo "Created data/ symlink to: $custom_path"
    ;;
  *)
    echo "Invalid choice. Exiting."
    exit 1
    ;;
esac

# Create subdirectories
mkdir -p "$DATA_DIR/briefings" "$DATA_DIR/briefings/archive" "$DATA_DIR/state" "$DATA_DIR/context"

# Copy templates
echo ""
echo "Populating with template files..."
for f in "$ASSISTANT_DIR/data-templates/context/"*.md; do
  dest="$DATA_DIR/context/$(basename "$f")"
  if [[ ! -f "$dest" ]]; then
    cp "$f" "$dest"
    echo "  Created $(basename "$f")"
  else
    echo "  Skipped $(basename "$f") (already exists)"
  fi
done

# Initialize the database
echo ""
echo "Initializing database..."
python3 "$ASSISTANT_DIR/scripts/atlas-db.py" commit list > /dev/null 2>&1 && \
  echo "  Database ready at data/state/assistant.db" || \
  echo "  Warning: Could not initialize database. Run atlas-db.py manually."

# Create symlinks for VS Code prompts and Things 3 (optional)
echo ""
echo "Optional symlinks:"
echo "  ln -sf \"\$(pwd)/prompts\" ~/Library/Application\\ Support/Code/User/prompts"
echo "  ln -sf \"\$(pwd)/things3\" ~/.local/bin/things3"
echo ""
echo "Setup complete! Edit data/context/identity.md to personalize your assistant."
