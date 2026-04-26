#!/usr/bin/env python3
"""Mark an Outlook email as read via Microsoft Graph API.

Usage:
    mark-read.py --email-id <graph_message_id> [--account work|personal]

Reuses the existing outlook-mcp auth infrastructure.
"""

import argparse
import os
import sys

SCRIPT_DIR = os.path.expanduser("~/.local/share/outlook-mcp")
GRAPH_BASE = "https://graph.microsoft.com/v1.0"

CONFIG_DIRS = {
    "work": os.path.expanduser("~/.config/outlook-mcp-work"),
    "personal": os.path.expanduser("~/.config/outlook-mcp"),
}


def get_token(account: str) -> str:
    sys.path.insert(0, SCRIPT_DIR)
    old_env = os.environ.get("OUTLOOK_MCP_CONFIG_DIR")
    os.environ["OUTLOOK_MCP_CONFIG_DIR"] = CONFIG_DIRS[account]

    import importlib
    import auth as outlook_auth
    importlib.reload(outlook_auth)

    if old_env is not None:
        os.environ["OUTLOOK_MCP_CONFIG_DIR"] = old_env
    else:
        os.environ.pop("OUTLOOK_MCP_CONFIG_DIR", None)

    cache = outlook_auth.get_token_cache()
    app = outlook_auth.build_app(cache)
    accounts = app.get_accounts()
    if not accounts:
        print("No cached accounts", file=sys.stderr)
        sys.exit(1)

    result = app.acquire_token_silent(outlook_auth.SCOPES, account=accounts[0])
    if result and "access_token" in result:
        outlook_auth.save_token_cache(cache)
        return result["access_token"]

    print("Token acquisition failed", file=sys.stderr)
    sys.exit(1)


def mark_read(token: str, message_id: str) -> bool:
    import httpx
    url = f"{GRAPH_BASE}/me/messages/{message_id}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    resp = httpx.patch(url, headers=headers, json={"isRead": True}, timeout=15)
    return resp.status_code == 200


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--email-id", required=True)
    parser.add_argument("--account", choices=["work", "personal"], default="work")
    args = parser.parse_args()

    token = get_token(args.account)
    ok = mark_read(token, args.email_id)
    if ok:
        print(f"Marked read: {args.email_id[:30]}...")
    else:
        print(f"Failed to mark read: {args.email_id[:30]}...", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
