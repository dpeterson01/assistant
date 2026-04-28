// Pure dashboard helpers. No DOM mutation, no module-level state.
// Imported by app.js and exercised by tests/helpers.test.js so the test suite
// can run under plain Node with no browser shim.

export const sourceMap = {
  'outlook-work': 'Outlook',
  'outlook-personal': 'Outlook (personal)',
  gmail: 'Gmail',
  hmbl: 'HMBL',
  teams: 'Teams',
  task: 'Things 3',
  github: 'GitHub',
};

export const sourceLabel = ch => sourceMap[ch] || ch || '';

export const sourceTint = ch => ({
  'outlook-work': 'bg-ios-blue/15 text-ios-blue',
  'outlook-personal': 'bg-ios-indigo/15 text-ios-indigo',
  gmail: 'bg-ios-red/15 text-ios-red',
  hmbl: 'bg-ios-teal/15 text-ios-teal',
  teams: 'bg-ios-indigo/15 text-ios-indigo',
  task: 'bg-ios-orange/15 text-ios-orange',
  github: 'bg-white/10 text-zinc-300',
}[ch] || 'bg-white/10 text-zinc-300');

export const priorityTint = p => ({
  high: 'bg-ios-red/15 text-ios-red ring-ios-red/20',
  medium: 'bg-ios-yellow/15 text-ios-yellow ring-ios-yellow/20',
  low: 'bg-ios-green/15 text-ios-green ring-ios-green/20',
}[p] || 'bg-white/5 text-zinc-400 ring-white/10');

// Color-blind safe affordance: a glyph alongside the priority color so the
// signal isn't carried by color alone.
export const priorityGlyph = p => ({ high: '●', medium: '◐', low: '○' }[p] || '');

export const categoryTint = cat => ({
  work: 'bg-ios-blue/15 text-ios-blue border-ios-blue/30',
  personal: 'bg-ios-green/15 text-ios-green border-ios-green/30',
  church: 'bg-ios-indigo/15 text-ios-indigo border-ios-indigo/30',
  hmbl: 'bg-ios-teal/15 text-ios-teal border-ios-teal/30',
}[cat] || 'bg-white/10 text-zinc-300 border-white/15');

export const categoryLabel = cat => ({
  work: 'Work', personal: 'Personal', church: 'Church', hmbl: 'HMBL',
}[cat] || (cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : ''));

export const dayFitPalette = lvl => ({
  red: { bg: 'bg-ios-red/10', border: 'border-ios-red/20', text: 'text-ios-red', glow: 'shadow-ios-red/10' },
  yellow: { bg: 'bg-ios-yellow/10', border: 'border-ios-yellow/20', text: 'text-ios-yellow', glow: 'shadow-ios-yellow/10' },
  green: { bg: 'bg-ios-green/10', border: 'border-ios-green/20', text: 'text-ios-green', glow: 'shadow-ios-green/10' },
}[lvl] || { bg: 'bg-white/5', border: 'border-white/10', text: 'text-zinc-300', glow: '' });

// String escapers. escapeHtml uses a manual replace (no DOM dep) so it works
// in Node tests; behavior matches the textContent-based original for any
// printable input.
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Strict attribute escape: prevents an injected value from breaking out of an
// HTML attribute (href, title, etc.). Always wrap the resulting attribute in
// double quotes.
export function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Date / time formatting. Browser-only because they call toLocaleDateString;
// kept here so all formatting helpers live in one place. Tests cover the
// pure parsing helpers below.
export function formatDate(s) {
  if (!s) return '';
  const d = new Date(s + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
export function shortDate(s) {
  if (!s) return '';
  const d = new Date(s + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
export function shortTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
export function shortDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' · '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Parse a meeting time string ("9:30 AM" or ISO "2026-04-27T08:00:00-07:00")
// into minutes from midnight, in the local timezone for ISO inputs.
export function parseMeetingTime(t) {
  if (!t) return null;
  const iso = new Date(t);
  if (!isNaN(iso.getTime()) && String(t).includes('T')) {
    return iso.getHours() * 60 + iso.getMinutes();
  }
  const m = String(t).match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2] || '0', 10);
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

export function formatMeetingTime(t) {
  if (!t) return '—';
  const iso = new Date(t);
  if (!isNaN(iso.getTime()) && String(t).includes('T')) {
    return iso.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return t;
}

// Extract a useful search term from an item: prefer explicit person/sender,
// otherwise pull a name out of common to-do phrasings so the resulting search
// URL is something useful.
export function searchTermForItem(item) {
  if (!item) return '';
  if (item.sender) return item.sender;
  if (item.person) return item.person;
  const text = item.text || item.item || '';
  let m = text.match(/^(?:Respond|Reply|Follow up|Follow-up|Ping|Email|Message|Nudge|Check in)\s+(?:to|with)\s+([A-Z][\w'\-]+(?:\s+[A-Z][\w'\-]+)?)/);
  if (m) return m[1];
  m = text.match(/^(?:Review|Read|Check)\s+([A-Z][\w'\-]+(?:\s+[A-Z][\w'\-]+)?)'s/);
  if (m) return m[1];
  m = text.match(/(?:from|with|for)\s+([A-Z][\w'\-]+\s+[A-Z][\w'\-]+)/);
  if (m) return m[1];
  return text;
}
