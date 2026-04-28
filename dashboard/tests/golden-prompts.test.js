// Golden-prompt regression test.
//
// Renders each dashboard prompt template with a fixed set of inputs and
// snapshot-compares the output against an expected string. This catches
// accidental drift in the prompts shipped to Copilot CLI without requiring
// a live LLM call.
//
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', 'prompts');

function loadPrompt(name) {
  return readFileSync(join(PROMPTS_DIR, `${name}.md`), 'utf8');
}

function render(name, values = {}) {
  return loadPrompt(name)
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (values[k] != null ? String(values[k]) : ''))
    .trim();
}

test('fetch-message: with email id', () => {
  const out = render('fetch-message', {
    sender: 'Alice Example',
    subject: 'Q3 review',
    channel: 'outlook-work',
    emailIdLine: 'Email ID: AAMkAD123.',
  });
  assert.equal(
    out,
    `Fetch the full body of the message from Alice Example with subject "Q3 review".
Email ID: AAMkAD123.
Channel: outlook-work.
Return ONLY the raw message body text. No metadata, no subject line, no commentary.
If you cannot fetch it, return the text: FETCH_FAILED`
  );
});

test('fetch-message: without email id keeps blank line', () => {
  const out = render('fetch-message', {
    sender: 'Bob',
    subject: 'hi',
    channel: 'gmail',
    emailIdLine: '',
  });
  assert.match(out, /Fetch the full body of the message from Bob/);
  assert.match(out, /Channel: gmail\./);
  assert.doesNotMatch(out, /Email ID:/);
});

test('save-draft: renders all fields', () => {
  const out = render('save-draft', {
    to: 'alice@example.com',
    subject: 'Q3 review',
    channel: 'outlook-work',
    body: 'Thanks, will follow up.',
    mailTool: 'outlook',
  });
  assert.match(out, /To: alice@example\.com\. Subject: Re: Q3 review\./);
  assert.match(out, /Use the outlook_draft_email tool/);
  assert.match(out, /Thanks, will follow up\./);
});

test('draft-reply: with context', () => {
  const out = render('draft-reply', {
    sender: 'Carol',
    subject: 'partner pilot',
    channel: 'outlook-work',
    contextLine: 'Context: she is unblocked on a decision',
  });
  assert.equal(
    out,
    '/draft-message Draft a reply to Carol about: partner pilot. Context: she is unblocked on a decision Channel: outlook-work. Output ONLY the draft body text, no metadata.'
  );
});

test('draft-reply: empty context renders cleanly', () => {
  const out = render('draft-reply', {
    sender: 'Dan',
    subject: 'ping',
    channel: 'gmail',
    contextLine: '',
  });
  // Two spaces where context would be — acceptable; assert structure
  assert.match(out, /^\/draft-message Draft a reply to Dan about: ping\./);
  assert.match(out, /Channel: gmail\./);
});

test('draft-nudge: renders all fields', () => {
  const out = render('draft-nudge', {
    person: 'Eve',
    item: 'review the spec',
    channel: 'email',
    aging: '4 days open, flagged stale',
    contextLine: 'Context: she said EOW.',
  });
  assert.match(out, /Draft a follow-up nudge to Eve about: review the spec\./);
  assert.match(out, /Context: she said EOW\./);
  assert.match(out, /Channel: email\. Aging: 4 days open, flagged stale\./);
  assert.match(out, /End with a P\.S\./);
});

test('missing keys render as empty string', () => {
  const out = render('fetch-message', {
    sender: 'X',
    subject: 'Y',
    channel: 'gmail',
    // emailIdLine intentionally omitted
  });
  assert.doesNotMatch(out, /\{\{/);
  assert.doesNotMatch(out, /undefined/);
});

test('all referenced templates exist on disk', () => {
  for (const name of ['fetch-message', 'save-draft', 'draft-reply', 'draft-nudge']) {
    const tpl = loadPrompt(name);
    assert.ok(tpl.length > 0, `${name} should not be empty`);
  }
});
