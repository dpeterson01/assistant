# Dashboard LLM prompts

These templates are the source of truth for every Copilot CLI prompt the
dashboard server invokes. They are loaded once at startup by `server.js` and
filled in with `${var}` style substitution.

Why externalize:
- Lets prompt edits ship without touching server logic.
- Makes diffs reviewable: a prompt change shows up as a single-file change.
- Enables a golden-prompt regression test (`tests/golden-prompts.test.js`)
  that catches accidental drift in the rendered prompt strings.

Substitution rules:
- `{{var}}` is replaced with the matching key from the values object.
- Missing keys render as the empty string. Lines that become empty are kept.
- Conditional fragments are passed in pre-formatted (e.g. `contextLine`,
  `emailIdLine`) rather than baked into the template; the server decides
  whether to include them.

Files:
- `fetch-message.md` — read the original message body for an inbox item.
- `save-draft.md` — save a composed reply as a draft via the mail MCP.
- `draft-reply.md` — generate a draft reply for an inbox item.
- `draft-nudge.md` — generate a follow-up nudge for a waiting-on entry.
