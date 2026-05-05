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

# Copy context templates
echo ""
echo "Populating with template files..."
for f in "$ASSISTANT_DIR/data-templates/context/"*.md; do
  dest="$DATA_DIR/context/$(basename "$f")"
  if [[ ! -f "$dest" ]]; then
    cp "$f" "$dest"
    echo "  Created context/$(basename "$f")"
  else
    echo "  Skipped context/$(basename "$f") (already exists)"
  fi
done

# Copy config template
if [[ ! -f "$DATA_DIR/config.yaml" ]]; then
  cp "$ASSISTANT_DIR/data-templates/config.yaml" "$DATA_DIR/config.yaml"
  echo "  Created config.yaml"
else
  echo "  Skipped config.yaml (already exists)"
fi

# Copy manifest template
MANIFEST_DEST="$ASSISTANT_DIR/automation/manifest.json"
if [[ ! -f "$MANIFEST_DEST" ]] && [[ -f "$ASSISTANT_DIR/automation/manifest.example.json" ]]; then
  cp "$ASSISTANT_DIR/automation/manifest.example.json" "$MANIFEST_DEST"
  echo "  Created automation/manifest.json"
fi

# Initialize the database
echo ""
echo "Initializing database..."
if python3 "$ASSISTANT_DIR/scripts/atlas-db.py" commit list > /dev/null 2>&1; then
  echo "  Database ready at data/state/assistant.db"
else
  echo "  Warning: Could not initialize database. Run 'python3 scripts/atlas-db.py commit list' to retry."
fi

# Optional: VS Code prompts symlink
echo ""
VSCODE_PROMPTS="$HOME/Library/Application Support/Code/User/prompts"
read -rp "Symlink prompts/ into VS Code? [y/N] " link_vscode
if [[ "${link_vscode,,}" == "y" ]]; then
  ln -sf "$ASSISTANT_DIR/prompts" "$VSCODE_PROMPTS"
  echo "  Linked prompts/ -> $VSCODE_PROMPTS"
fi

# Optional: Things 3 scripts symlink
read -rp "Symlink things3/ scripts to ~/.local/bin/things3? [y/N] " link_things
if [[ "${link_things,,}" == "y" ]]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$ASSISTANT_DIR/things3" "$HOME/.local/bin/things3"
  echo "  Linked things3/ -> ~/.local/bin/things3"
fi

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit data/config.yaml — set your journal paths, email channels, and employer domain."
echo "  2. Edit data/context/identity.md — add your name, role, and team."
echo "  3. Edit data/context/priorities.md — set your current priorities."
echo ""
echo "Dashboard: cd dashboard && npm install && npm start (opens on port 3141)"
echo "Automation: see automation/README.md for scheduled job setup"
