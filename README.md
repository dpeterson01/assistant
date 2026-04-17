# Assistant

Personal AI assistant configuration: VS Code prompts, Things 3 scripts, and utility scripts.

## Structure

```
prompts/          VS Code Copilot prompts (symlinked from ~/Library/Application Support/Code/User/prompts)
things3/          Things 3 CLI scripts (symlinked from ~/.local/bin/things3)
filter-scripts/   Email/spam filter scripts (symlinked from ~/.local/bin/)
```

## Setup

After cloning, create symlinks:

```sh
ln -sf "$(pwd)/prompts" ~/Library/Application\ Support/Code/User/prompts
ln -sf "$(pwd)/things3" ~/.local/bin/things3
ln -sf "$(pwd)/filter-scripts/filter-spam-emails.py" ~/.local/bin/filter-spam-emails.py
```

## Backups

Original files are backed up at:
- `~/Library/Application Support/Code/User/prompts.bak`
- `~/.local/bin/things3.bak`
- `~/.local/bin/filter-spam-emails.py.bak`

Safe to remove once this repo is pushed to GitHub.
