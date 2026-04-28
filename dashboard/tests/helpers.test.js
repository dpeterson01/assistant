// Pure-helper regression tests. These cover the functions in
// public/helpers.js that have no DOM dependencies, so they run under plain
// `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sourceLabel, sourceTint,
  priorityTint, priorityGlyph,
  categoryLabel, categoryTint,
  dayFitPalette,
  escapeHtml, escapeAttr,
  parseMeetingTime, formatMeetingTime,
  searchTermForItem,
} from '../public/helpers.js';

test('sourceLabel maps known channels', () => {
  assert.equal(sourceLabel('outlook-work'), 'Outlook');
  assert.equal(sourceLabel('teams'), 'Teams');
  assert.equal(sourceLabel('task'), 'Things 3');
  assert.equal(sourceLabel('github'), 'GitHub');
});

test('sourceLabel falls back to raw value', () => {
  assert.equal(sourceLabel('unknown'), 'unknown');
  assert.equal(sourceLabel(''), '');
  assert.equal(sourceLabel(null), '');
});

test('sourceTint returns class string for known and unknown', () => {
  assert.match(sourceTint('outlook-work'), /text-ios-blue/);
  assert.match(sourceTint('task'), /text-ios-orange/);
  assert.equal(sourceTint('mystery'), 'bg-white/10 text-zinc-300');
});

test('priorityTint and priorityGlyph cover all levels', () => {
  assert.match(priorityTint('high'), /text-ios-red/);
  assert.match(priorityTint('medium'), /text-ios-yellow/);
  assert.match(priorityTint('low'), /text-ios-green/);
  assert.match(priorityTint(undefined), /text-zinc-400/);

  assert.equal(priorityGlyph('high'), '●');
  assert.equal(priorityGlyph('medium'), '◐');
  assert.equal(priorityGlyph('low'), '○');
  assert.equal(priorityGlyph('weird'), '');
});

test('categoryLabel handles known and unknown', () => {
  assert.equal(categoryLabel('work'), 'Work');
  assert.equal(categoryLabel('hmbl'), 'HMBL');
  assert.equal(categoryLabel('finance'), 'Finance');
  assert.equal(categoryLabel(''), '');
});

test('categoryTint returns a tint string', () => {
  assert.match(categoryTint('work'), /text-ios-blue/);
  assert.match(categoryTint('mystery'), /text-zinc-300/);
});

test('dayFitPalette returns full palette for each level', () => {
  for (const lvl of ['red', 'yellow', 'green']) {
    const p = dayFitPalette(lvl);
    assert.ok(p.bg && p.border && p.text, `level ${lvl} has all keys`);
  }
  const fallback = dayFitPalette('mystery');
  assert.equal(fallback.glow, '');
});

test('escapeHtml encodes html-significant chars', () => {
  assert.equal(escapeHtml('<b>"x" & \'y\'</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

test('escapeAttr is safe to drop into double-quoted attributes', () => {
  assert.equal(escapeAttr(`" onerror="alert(1)`), '&quot; onerror=&quot;alert(1)');
  assert.equal(escapeAttr(`</script>`), '&lt;/script&gt;');
});

test('parseMeetingTime handles AM/PM and ISO', () => {
  assert.equal(parseMeetingTime('9:30 AM'), 9 * 60 + 30);
  assert.equal(parseMeetingTime('12:00 AM'), 0);
  assert.equal(parseMeetingTime('12:00 PM'), 12 * 60);
  assert.equal(parseMeetingTime('1:15 PM'), 13 * 60 + 15);
  assert.equal(parseMeetingTime(''), null);
  assert.equal(parseMeetingTime(null), null);

  const iso = parseMeetingTime('2026-04-27T08:00:00-07:00');
  // Result is local-zone minutes; verify it's a sensible number.
  assert.ok(typeof iso === 'number' && iso >= 0 && iso < 24 * 60);
});

test('formatMeetingTime passes through plain strings', () => {
  assert.equal(formatMeetingTime('9:30 AM'), '9:30 AM');
  assert.equal(formatMeetingTime(''), '—');
  assert.equal(formatMeetingTime(null), '—');
});

test('searchTermForItem prefers explicit fields', () => {
  assert.equal(searchTermForItem({ sender: 'Alice', text: 'foo' }), 'Alice');
  assert.equal(searchTermForItem({ person: 'Bob' }), 'Bob');
});

test('searchTermForItem extracts names from common phrasings', () => {
  assert.equal(
    searchTermForItem({ text: 'Respond to Tara Kaelin on Slalom pilot decision' }),
    'Tara Kaelin'
  );
  assert.equal(
    searchTermForItem({ text: "Review Heather's AXE promo card" }),
    'Heather'
  );
  assert.equal(
    searchTermForItem({ text: 'Reply to Bob about the spec' }),
    'Bob'
  );
});

test('searchTermForItem falls back to text when no name matches', () => {
  const text = 'Decide on HMBL M365 auto-renewal';
  assert.equal(searchTermForItem({ text }), text);
  assert.equal(searchTermForItem(null), '');
  assert.equal(searchTermForItem({}), '');
});
