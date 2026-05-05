#!/usr/bin/env bash
# Atlas Assistant Setup
# Interactive wizard that creates data/, discovers your life contexts,
# configures storage rules, and generates config.yaml.
# Run this after cloning the repo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSISTANT_DIR="$SCRIPT_DIR"
DATA_DIR="$ASSISTANT_DIR/data"

# ── Helpers ──────────────────────────────────────────────────────────────────

bold()  { printf '\033[1m%s\033[0m' "$*"; }
dim()   { printf '\033[2m%s\033[0m' "$*"; }
green() { printf '\033[32m%s\033[0m' "$*"; }
yellow(){ printf '\033[33m%s\033[0m' "$*"; }

ask_yn() {         # ask_yn "prompt" -> sets REPLY to y or n
  local prompt="$1" default="${2:-n}"
  local hint="[y/N]"; [[ "$default" == "y" ]] && hint="[Y/n]"
  while true; do
    read -rp "$prompt $hint " REPLY
    REPLY="${REPLY,,}"
    [[ -z "$REPLY" ]] && REPLY="$default"
    [[ "$REPLY" == "y" || "$REPLY" == "n" ]] && return 0
    echo "  Please enter y or n."
  done
}

ask_text() {       # ask_text "prompt" "default" -> sets REPLY
  local prompt="$1" default="${2:-}"
  if [[ -n "$default" ]]; then
    read -rp "$prompt [${default}]: " REPLY
    [[ -z "$REPLY" ]] && REPLY="$default"
  else
    while true; do
      read -rp "$prompt: " REPLY
      [[ -n "$REPLY" ]] && return 0
      echo "  A value is required."
    done
  fi
}

expand_path() {    # expand_path "~/foo" -> /Users/me/foo
  echo "${1/#\~/$HOME}"
}

# ── Banner ───────────────────────────────────────────────────────────────────

echo ""
echo "$(bold 'Atlas Assistant Setup')"
echo "$(dim '═════════════════════')"
echo ""

# ── Guard: re-run ────────────────────────────────────────────────────────────

if [[ -e "$DATA_DIR" ]]; then
  echo "$(yellow 'data/ already exists.') Re-running setup would overwrite config.yaml."
  ask_yn "Continue anyway?"
  [[ "$REPLY" == "n" ]] && { echo "Exiting."; exit 0; }
  echo ""
fi

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 1: Data directory location
# ══════════════════════════════════════════════════════════════════════════════

if [[ ! -e "$DATA_DIR" ]]; then
  echo "$(bold 'Where should Atlas store your personal data?')"
  echo "This directory holds briefings, journals, identity, and the database."
  echo "It is $(bold 'gitignored') so nothing here reaches GitHub."
  echo ""
  echo "  1) Local directory inside the repo  $(dim '(simple, no cloud backup)')"
  echo "  2) iCloud Drive                     $(dim '(synced across Apple devices)')"
  echo "  3) Custom path                      $(dim '(OneDrive, Dropbox, etc.)')"
  echo ""
  read -rp "Choose [1/2/3]: " storage_choice

  case "$storage_choice" in
    1)
      mkdir -p "$DATA_DIR"
      echo "$(green '  Created') data/ as a local directory."
      ;;
    2)
      ICLOUD_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/personal/atlas-data"
      mkdir -p "$ICLOUD_DIR"
      ln -s "$ICLOUD_DIR" "$DATA_DIR"
      echo "$(green '  Created') data/ -> iCloud Drive"
      ;;
    3)
      ask_text "Enter the full path"
      custom_path="$(expand_path "$REPLY")"
      mkdir -p "$custom_path"
      ln -s "$custom_path" "$DATA_DIR"
      echo "$(green '  Created') data/ -> $custom_path"
      ;;
    *)
      echo "Invalid choice. Exiting."
      exit 1
      ;;
  esac
  echo ""
fi

mkdir -p "$DATA_DIR/briefings" "$DATA_DIR/briefings/archive" "$DATA_DIR/state" "$DATA_DIR/context"

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 2: Life contexts (categories)
# ══════════════════════════════════════════════════════════════════════════════

echo "$(bold 'Life Contexts')"
echo "Atlas organizes everything by life context (e.g., Work, Personal,"
echo "Church, Side Project). Each context becomes a dashboard filter pill"
echo "and a Things 3 Area."
echo ""
echo "$(dim 'Most people start with 2-4 contexts. You can add more later in config.yaml.')"
echo ""

declare -a CAT_IDS=()
declare -a CAT_LABELS=()
declare -a CAT_EMOJIS=()
declare -a CAT_JOURNAL_PATHS=()
declare -a CAT_STORAGE_RULES=()  # "any" or "isolated"

cat_count=0
while true; do
  ((cat_count++))
  echo "--- $(bold "Context #${cat_count}") ---"

  ask_text "Label (e.g., Work, Personal, Church, Side Project)"
  local_label="$REPLY"

  # Auto-generate an id from the label
  local_id="$(echo "$local_label" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')"
  ask_text "Short id for internal use" "$local_id"
  local_id="$REPLY"

  ask_text "Emoji (optional, press Enter to skip)" ""
  local_emoji="$REPLY"

  # Journal path
  echo ""
  echo "  Where should $(bold "$local_label") journals be stored?"
  echo "    1) Local folder         $(dim "~/Documents/journals/${local_id}/")"
  echo "    2) iCloud Drive         $(dim "~/Library/Mobile Documents/.../journals/")"
  echo "    3) OneDrive             $(dim "~/Library/CloudStorage/OneDrive-.../")"
  echo "    4) Custom path"
  echo "    5) No journal for this context"
  read -rp "  Choose [1/2/3/4/5]: " jchoice

  case "$jchoice" in
    1) local_journal="~/Documents/journals/${local_id}/%Y-%m-%d.md" ;;
    2)
      ask_text "  iCloud subfolder" "personal/journals/${local_id}"
      local_journal="~/Library/Mobile Documents/com~apple~CloudDocs/${REPLY}/%Y-%m-%d.md"
      ;;
    3)
      ask_text "  OneDrive account name (the part after OneDrive-)"
      local_onedrive_acct="$REPLY"
      ask_text "  Subfolder inside OneDrive" "journals/${local_id}"
      local_journal="~/Library/CloudStorage/OneDrive-${local_onedrive_acct}/${REPLY}/%Y-%m-%d.md"
      ;;
    4)
      ask_text "  Full journal path (use %Y-%m-%d.md for dates)"
      local_journal="$REPLY"
      ;;
    5) local_journal="" ;;
    *) local_journal="" ;;
  esac

  # Data isolation rules
  echo ""
  echo "  $(bold 'Data isolation') for $(bold "$local_label"):"
  echo "    1) Consolidated  $(dim '- journals/data can be stored alongside other contexts')"
  echo "    2) Isolated      $(dim '- data must stay separate (e.g., employer policy)')"
  read -rp "  Choose [1/2]: " iso_choice
  case "$iso_choice" in
    2) local_storage_rule="isolated" ;;
    *) local_storage_rule="any" ;;
  esac

  if [[ "$local_storage_rule" == "isolated" ]]; then
    echo "  $(yellow '  ⚠ Isolated:') Atlas will not mix $(bold "$local_label") data with other contexts."
  fi

  CAT_IDS+=("$local_id")
  CAT_LABELS+=("$local_label")
  CAT_EMOJIS+=("$local_emoji")
  CAT_JOURNAL_PATHS+=("$local_journal")
  CAT_STORAGE_RULES+=("$local_storage_rule")

  echo ""
  ask_yn "Add another context?"
  [[ "$REPLY" == "n" ]] && break
  echo ""
done

echo ""
echo "$(green 'Contexts configured:')"
for i in "${!CAT_IDS[@]}"; do
  local_e="${CAT_EMOJIS[$i]}"
  [[ -n "$local_e" ]] && local_e=" $local_e"
  local_iso=""
  [[ "${CAT_STORAGE_RULES[$i]}" == "isolated" ]] && local_iso=" $(yellow '[isolated]')"
  echo "  ${CAT_LABELS[$i]}${local_e} (${CAT_IDS[$i]})${local_iso}"
done
echo ""

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 3: GitHub account verification
# ══════════════════════════════════════════════════════════════════════════════

echo "$(bold 'GitHub Account')"
echo "Checking your git and GitHub CLI configuration..."
echo ""

GIT_USER="$(git config user.name 2>/dev/null || echo '')"
GIT_EMAIL="$(git config user.email 2>/dev/null || echo '')"
GH_USER="$(gh auth status 2>&1 | grep 'Logged in' | sed 's/.*account //' | sed 's/ .*//' || echo '')"

if [[ -n "$GIT_USER" ]]; then
  echo "  git user.name:  $(bold "$GIT_USER")"
fi
if [[ -n "$GIT_EMAIL" ]]; then
  echo "  git user.email: $(bold "$GIT_EMAIL")"
fi
if [[ -n "$GH_USER" ]]; then
  echo "  gh CLI account: $(bold "$GH_USER")"
fi
echo ""

ask_yn "Is this the correct account for this assistant repo?" "y"
if [[ "$REPLY" == "n" ]]; then
  echo ""
  echo "$(yellow 'Please configure git and gh CLI before continuing:')"
  echo "  git config user.name \"Your Name\""
  echo "  git config user.email \"you@example.com\""
  echo "  gh auth login"
  echo ""
  echo "Then re-run ./setup.sh"
  exit 1
fi

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 4: Employer domain
# ══════════════════════════════════════════════════════════════════════════════

echo ""
echo "$(bold 'Employer Domain')"
echo "Used to classify meeting attendees as internal vs. external."
ask_text "Your work email domain (e.g., microsoft.com)" ""
EMPLOYER_DOMAIN="$REPLY"

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 5: Generate config.yaml
# ══════════════════════════════════════════════════════════════════════════════

echo ""
echo "$(bold 'Generating config.yaml...')"

CONFIG_FILE="$DATA_DIR/config.yaml"
cat > "$CONFIG_FILE" <<'HEADER'
# Atlas Assistant Configuration
# Generated by setup.sh. Edit freely — the assistant reads this at startup
# to know your life contexts, email accounts, and channel routing.

HEADER

# Categories
{
  echo "# --- Life Contexts (Categories) ---"
  echo "# Each category becomes a filter pill on the dashboard and a Things 3 Area."
  echo "categories:"
  for i in "${!CAT_IDS[@]}"; do
    echo "  - id: ${CAT_IDS[$i]}"
    echo "    label: ${CAT_LABELS[$i]}"
    if [[ -n "${CAT_EMOJIS[$i]}" ]]; then
      echo "    emoji: \"${CAT_EMOJIS[$i]}\""
    fi
    if [[ "${CAT_STORAGE_RULES[$i]}" == "isolated" ]]; then
      echo "    isolated: true    # data must not bleed into other contexts"
    fi
  done
  echo ""
} >> "$CONFIG_FILE"

# Channels (write a starter set)
cat >> "$CONFIG_FILE" <<'CHANNELS'
# --- Email Channels ---
# Each channel maps to an MCP tool prefix and a deep-link URL pattern.
# MCP tool prefixes: mailtools (Exchange), outlook (Outlook.com), gmail (Gmail)
channels:
  - id: outlook-work
    label: Work Email
    category: work
    mcp_prefix: mailtools
    deep_link: "https://outlook.office365.com/mail/deeplink/read/{emailId}"
    search_link: "https://outlook.office365.com/mail/0/search?q={query}"
    placeholder: "[work-email]"

  - id: outlook-personal
    label: Personal Email
    category: personal
    mcp_prefix: outlook
    deep_link: "https://outlook.live.com/mail/deeplink/read/{emailId}"
    search_link: "https://outlook.office365.com/mail/0/search?q={query}"
    placeholder: "[personal-email]"

  # Uncomment and customize additional channels:
  # - id: gmail
  #   label: Gmail
  #   category: personal
  #   mcp_prefix: gmail
  #   deep_link: "https://mail.google.com/mail/u/0/#inbox/{emailId}"
  #   search_link: "https://mail.google.com/mail/u/0/#search/{query}"
  #   placeholder: "[gmail]"

  - id: teams
    label: Teams
    category: work
    mcp_prefix: teamsserver
    deep_link: "https://teams.microsoft.com/l/message/{threadId}"
    search_link: "https://teams.microsoft.com/_#/search?q={query}"

  - id: imessage
    label: iMessage
    category: personal
    mcp_prefix: mac-messages

CHANNELS

# Channel tags
cat >> "$CONFIG_FILE" <<'TAGS'
# --- Channel Tags ---
# Maps channel IDs to Things 3 tag names for task routing.
channel_tags:
  outlook-work: MS-Email
  outlook-personal: Personal-Email
  gmail: Personal-Email
  teams: Teams
  email: MS-Email
  meeting: Teams

TAGS

# Journals
{
  echo "# --- Journal Paths ---"
  echo "# Where daily journals are stored for each context."
  echo "# Use ~ for home directory. Supports strftime format codes (%Y-%m-%d)."
  echo "journals:"
  for i in "${!CAT_IDS[@]}"; do
    if [[ -n "${CAT_JOURNAL_PATHS[$i]}" ]]; then
      echo "  ${CAT_IDS[$i]}: \"${CAT_JOURNAL_PATHS[$i]}\""
    else
      echo "  # ${CAT_IDS[$i]}: \"\"   # no journal configured"
    fi
  done
  echo ""
} >> "$CONFIG_FILE"

# Employer domain
{
  echo "# --- Employer Domain ---"
  echo "# Used to classify meeting attendees as internal vs external."
  echo "employer_domain: \"${EMPLOYER_DOMAIN}\""
  echo ""
} >> "$CONFIG_FILE"

# Contacts, workflows (templates)
cat >> "$CONFIG_FILE" <<'FOOTER'
# --- Contacts ---
# Paths to contact index files. Each has a name-to-file JSON mapping.
contacts:
  work: "~/Documents/contacts/work/index.json"
  # community: "~/Documents/contacts/community/index.json"

# --- Data Isolation Rules ---
# Categories marked isolated: true above will have their data kept separate.
# The assistant will not mix isolated context data with other contexts in:
#   - journal searches (won't cross-reference)
#   - briefing sections (separate sections)
#   - Things 3 (separate Areas)
# This is useful for employer policies that prohibit storing work data
# on personal storage, or vice versa.

# --- Employer-Specific Workflows ---
# Optional workflow integrations. Remove or replace with your own.
workflows:
  # ado:
  #   organization: "your-org"
  #   project: "your-project"
  # performance_review: "Connects"
FOOTER

echo "$(green '  Created') data/config.yaml"

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 6: Context templates + database
# ══════════════════════════════════════════════════════════════════════════════

echo ""
echo "$(bold 'Populating template files...')"
for f in "$ASSISTANT_DIR/data-templates/context/"*.md; do
  dest="$DATA_DIR/context/$(basename "$f")"
  if [[ ! -f "$dest" ]]; then
    cp "$f" "$dest"
    echo "  $(green Created) context/$(basename "$f")"
  else
    echo "  $(dim Skipped) context/$(basename "$f") (already exists)"
  fi
done

# Copy manifest template
MANIFEST_DEST="$ASSISTANT_DIR/automation/manifest.json"
if [[ ! -f "$MANIFEST_DEST" ]] && [[ -f "$ASSISTANT_DIR/automation/manifest.example.json" ]]; then
  cp "$ASSISTANT_DIR/automation/manifest.example.json" "$MANIFEST_DEST"
  echo "  $(green Created) automation/manifest.json"
fi

# Initialize the database
echo ""
echo "Initializing database..."
if python3 "$ASSISTANT_DIR/scripts/atlas-db.py" commit list > /dev/null 2>&1; then
  echo "  $(green '  Database ready') at data/state/assistant.db"
else
  echo "  $(yellow '  Warning:') Could not initialize database. Run 'python3 scripts/atlas-db.py commit list' to retry."
fi

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 7: Optional symlinks
# ══════════════════════════════════════════════════════════════════════════════

echo ""
VSCODE_PROMPTS="$HOME/Library/Application Support/Code/User/prompts"
ask_yn "Symlink prompts/ into VS Code?"
if [[ "$REPLY" == "y" ]]; then
  ln -sf "$ASSISTANT_DIR/prompts" "$VSCODE_PROMPTS"
  echo "  $(green Linked) prompts/ -> VS Code"
fi

ask_yn "Symlink things3/ scripts to ~/.local/bin/things3?"
if [[ "$REPLY" == "y" ]]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$ASSISTANT_DIR/things3" "$HOME/.local/bin/things3"
  echo "  $(green Linked) things3/ -> ~/.local/bin/things3"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Done
# ══════════════════════════════════════════════════════════════════════════════

echo ""
echo "$(bold '════════════════════════════════════')"
echo "$(green '  Setup complete!')"
echo "$(bold '════════════════════════════════════')"
echo ""
echo "$(bold 'Next steps:')"
echo "  1. Review $(bold 'data/config.yaml') and adjust email channels, contacts, workflows."
echo "  2. Edit $(bold 'data/context/identity.md') with your name, role, and team."
echo "  3. Edit $(bold 'data/context/priorities.md') with your current priorities."
echo ""

# Print isolation warnings if any
has_isolated=false
for i in "${!CAT_IDS[@]}"; do
  if [[ "${CAT_STORAGE_RULES[$i]}" == "isolated" ]]; then
    if [[ "$has_isolated" == "false" ]]; then
      echo "$(yellow 'Data isolation reminders:')"
      has_isolated=true
    fi
    echo "  $(yellow '⚠') $(bold "${CAT_LABELS[$i]}") is marked isolated. Ensure its journal path"
    echo "    does not overlap with other contexts' storage."
  fi
done
[[ "$has_isolated" == "true" ]] && echo ""

echo "$(dim 'Dashboard:')   cd dashboard && npm install && npm start"
echo "$(dim 'Automation:')  see automation/README.md for scheduled job setup"
