import express from 'express';
import { readFileSync, readdirSync, writeFileSync, existsSync, watch } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3141;

const BRIEFINGS_DIR = join(__dirname, '..', 'briefings');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, 'public')));

// --- File helpers ---

function briefingPath(date) {
  if (date) return join(BRIEFINGS_DIR, `${date}_daily_brief.json`);
  // Latest
  const files = readdirSync(BRIEFINGS_DIR)
    .filter(f => f.endsWith('_daily_brief.json'))
    .sort()
    .reverse();
  return files.length ? join(BRIEFINGS_DIR, files[0]) : null;
}

function readBriefing(date) {
  const p = briefingPath(date);
  if (!p || !existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function writeBriefing(data) {
  const p = briefingPath(data.date);
  if (!p) throw new Error('Cannot determine briefing path');
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  // The fs.watch in the SSE block will also fire; the debounce coalesces.
  // Calling scheduleBroadcast directly guarantees at-least-one push even on
  // filesystems where watch is unreliable (e.g., some network mounts).
  if (typeof scheduleBroadcast === 'function') scheduleBroadcast('write');
}

function now() { return new Date().toISOString(); }

// --- Health tracking ---
// Tracks last call result for each endpoint. Stored in-memory (resets on restart).
const health = {};

function trackHealth(name, ok, detail) {
  health[name] = { ok, detail: detail || null, at: now() };
}

// GET /api/health — stoplight status for all tracked operations
app.get('/api/health', (_req, res) => {
  const allOk = Object.values(health).every(h => h.ok);
  res.json({ allOk, lastChecked: now(), endpoints: health, queueDepth: sideEffectQueue.length, regenerating: !!regenProc });
});

// --- Regenerate briefing: runs the full morning-briefing agent ---
// POST /api/regenerate — kicks off morning-briefing.sh in the background.
// Returns immediately. The SSE stream pushes a 'regenerating' event so the
// dashboard can show a spinner. When the new JSON lands on disk, the fs.watch
// triggers the normal 'briefing' event.

let regenProc = null;

app.post('/api/regenerate', (_req, res) => {
  if (regenProc) {
    return res.status(409).json({ error: 'Regeneration already in progress', pid: regenProc.pid });
  }

  const script = join(__dirname, '..', 'automation', 'scripts', 'morning-briefing.sh');
  const logDir = join(__dirname, '..', 'automation', 'logs');
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local tz

  // Remove the "already exists" guard by setting env var that the script can check
  const env = {
    ...process.env,
    ATLAS_FORCE_REGEN: '1',
    HOME: process.env.HOME || '/Users/derekpeterson',
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:' + (process.env.HOME || '/Users/derekpeterson') + '/.local/bin',
  };

  regenProc = execFile('/bin/zsh', [script], { env, timeout: 720_000, cwd: __dirname }, (err) => {
    const ok = !err;
    trackHealth('regenerate', ok, ok ? `completed ${now()}` : `failed: ${err.message}`);
    console.log(`[regen] finished: ${ok ? 'success' : err.message}`);
    regenProc = null;
    broadcast('regenerate-done', { ok, at: now() });
  });

  // Detach so server doesn't block
  regenProc.unref?.();

  trackHealth('regenerate', true, `started ${now()}`);
  broadcast('regenerating', { at: now() });
  console.log(`[regen] started, pid=${regenProc.pid}`);
  res.json({ status: 'started', pid: regenProc.pid });
});

// --- Server-Sent Events: live push of briefing updates ---
// Clients connect to /api/events and stay open. We push:
//   - event: hello       on connect (with current lastUpdated)
//   - event: briefing    when the JSON file on disk changes
//   - event: ping        every 25s to keep proxies/browsers from closing the stream
// The dashboard re-fetches /api/briefing on every `briefing` event.

const sseClients = new Set();

function sseSend(client, event, data) {
  try {
    client.write(`event: ${event}\n`);
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch { /* client gone, will be cleaned up */ }
}

function broadcast(event, data) {
  for (const c of sseClients) sseSend(c, event, data);
}

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  sseClients.add(res);

  // Greet with current snapshot id so the client knows it's connected
  const data = readBriefing();
  sseSend(res, 'hello', { lastUpdated: data?.lastUpdated || null, date: data?.date || null });

  const ping = setInterval(() => sseSend(res, 'ping', { t: now() }), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

// Watch the briefings directory for any change to today's JSON and broadcast.
// Coalesce bursts (writeBriefing fires multiple fs events) with a small debounce.
let broadcastTimer = null;
function scheduleBroadcast(reason) {
  if (broadcastTimer) clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    const data = readBriefing();
    broadcast('briefing', {
      reason,
      date: data?.date || null,
      lastUpdated: data?.lastUpdated || null,
      updateCount: data?.updateCount || 0,
    });
  }, 150);
}

try {
  watch(BRIEFINGS_DIR, { persistent: true }, (_evt, filename) => {
    if (!filename || !filename.endsWith('_daily_brief.json')) return;
    scheduleBroadcast('file-change');
  });
} catch (err) {
  console.warn('Could not watch briefings dir for live updates:', err.message);
}

// --- Item status helpers ---

// Status values: "open" | "done" | "dismissed" | "snoozed"
// When status changes to done/dismissed, syncPending is set so the
// periodic update job can propagate to Things 3, Outlook, action-items.md.
// source: who triggered the change ("ui" | "sync" | "agent:<name>" | "api")

function findItem(data, id) {
  for (const section of ['carryOver', 'inbox', 'tasks']) {
    const list = data[section];
    if (!list) continue;
    const item = list.find(i => i.id === id);
    if (item) return item;
  }
  return null;
}

const THINGS3_DIR = join(__dirname, '..', 'things3');
const MARK_READ_SCRIPT = join(__dirname, '..', 'scripts', 'mark-read.py');

// --- Side-effect queue with retry ---
// All external integrations (Things 3, Graph API, etc.) run through this queue.
// Jobs retry up to 3 times with exponential backoff. The queue processes one job
// at a time to avoid overwhelming external services.

const sideEffectQueue = [];
let queueProcessing = false;

function enqueue(label, fn, { maxRetries = 3, backoffMs = 2000 } = {}) {
  sideEffectQueue.push({ label, fn, attempt: 0, maxRetries, backoffMs });
  drainQueue();
}

function drainQueue() {
  if (queueProcessing || sideEffectQueue.length === 0) return;
  queueProcessing = true;
  const job = sideEffectQueue.shift();
  runJob(job);
}

function runJob(job) {
  job.attempt++;
  job.fn((err, result) => {
    if (err && job.attempt < job.maxRetries) {
      const delay = job.backoffMs * Math.pow(2, job.attempt - 1);
      console.warn(`[queue] ${job.label} attempt ${job.attempt} failed, retrying in ${delay}ms: ${err.message || err}`);
      setTimeout(() => {
        queueProcessing = false;
        sideEffectQueue.unshift(job);
        drainQueue();
      }, delay);
    } else {
      if (err) console.error(`[queue] ${job.label} failed after ${job.attempt} attempts: ${err.message || err}`);
      else console.log(`[queue] ${job.label}: ${result || 'ok'}`);
      queueProcessing = false;
      drainQueue();
    }
  });
}

function things3Complete(text) {
  if (!text) return;
  enqueue(`Things3 complete "${text.slice(0, 40)}"`, (done) => {
    execFile(join(THINGS3_DIR, 'complete.sh'), ['--search', text], { timeout: 10000 },
      (err, stdout, stderr) => done(err || (stderr && stderr.includes('not found') ? new Error(stderr) : null), stdout?.trim()));
  });
}

function things3Delete(text) {
  if (!text) return;
  enqueue(`Things3 delete "${text.slice(0, 40)}"`, (done) => {
    execFile(join(THINGS3_DIR, 'delete.sh'), ['--search', text], { timeout: 10000 },
      (err, stdout, stderr) => done(err || (stderr && stderr.includes('not found') ? new Error(stderr) : null), stdout?.trim()));
  });
}

function markEmailRead(item) {
  if (!item.emailId) return;
  const channel = item.channel || '';
  let account = 'work';
  if (channel === 'outlook-personal') account = 'personal';
  else if (!channel.startsWith('outlook')) return;

  enqueue(`Mark-read ${item.id} (${account})`, (done) => {
    execFile('python3', [MARK_READ_SCRIPT, '--email-id', item.emailId, '--account', account],
      { timeout: 15000 },
      (err, stdout, stderr) => done(err, stdout?.trim()));
  });
}

// Teams mark-as-read: blocked by admin consent for Chat.ReadWrite scope.
// When scope is approved, add markTeamsChatRead() here using mark-teams-read.py.

function setItemStatus(data, id, status, source = 'api') {
  const ts = now();
  for (const section of ['carryOver', 'inbox', 'tasks']) {
    const list = data[section];
    if (!list) continue;
    const item = list.find(i => i.id === id);
    if (item) {
      item.status = status;
      item.updatedAt = ts;
      item.source = source;
      if (status === 'done' || status === 'dismissed') {
        item.syncPending = true;
      }
      return true;
    }
  }
  return false;
}

// --- API Routes ---

// GET /api/briefing?date=2026-04-23 (optional, defaults to latest)
app.get('/api/briefing', (req, res) => {
  const data = readBriefing(req.query.date);
  if (!data) {
    trackHealth('GET /api/briefing', false, 'No briefing found');
    return res.status(404).json({ error: 'No briefing found' });
  }
  trackHealth('GET /api/briefing', true);
  res.json(data);
});

// PATCH /api/briefing — incremental update (used by 15-min cron job)
//
// Accepts a partial payload. Merge rules:
//   - inbox: new items appended (matched by id, existing items updated)
//   - carryOver / tasks: same merge-by-id
//   - meetings: merge-by-id (update attended, signals, etc.)
//   - dayFit: full replace if provided
//   - accountability: full replace if provided
//   - scalar fields (lastUpdated, updateCount): auto-set
app.patch('/api/briefing', (req, res) => {
  const data = readBriefing(req.body.date);
  if (!data) return res.status(404).json({ error: 'No briefing found for date' });

  const patch = req.body;
  const ts = now();

  // Merge array sections by id
  for (const section of ['inbox', 'carryOver', 'tasks', 'meetings']) {
    if (!patch[section]) continue;
    if (!data[section]) data[section] = [];
    for (const incoming of patch[section]) {
      const existing = data[section].find(i => i.id === incoming.id);
      if (existing) {
        Object.assign(existing, incoming, { updatedAt: ts });
      } else {
        data[section].push({ ...incoming, addedAt: incoming.addedAt || ts });
      }
    }
  }

  // Full-replace sections
  for (const section of ['dayFit', 'accountability', 'upcoming']) {
    if (patch[section]) data[section] = patch[section];
  }

  // Scalars
  if (patch.inboxLowCount != null) data.inboxLowCount = patch.inboxLowCount;

  data.lastUpdated = ts;
  data.updateCount = (data.updateCount || 0) + 1;

  writeBriefing(data);
  trackHealth('PATCH /api/briefing', true);
  res.json({ ok: true, lastUpdated: data.lastUpdated, updateCount: data.updateCount });
});

// POST /api/complete-task/:id — mark done in JSON + complete in Things 3
app.post('/api/complete-task/:id', (req, res) => {
  try {
    const data = readBriefing();
    const source = req.body?.source || 'api';
    const item = findItem(data, req.params.id);
    if (!item) {
      trackHealth('POST /api/complete-task', false, 'Item not found');
      return res.status(404).json({ error: 'Item not found' });
    }
    const text = item.text || '';
    const found = setItemStatus(data, req.params.id, 'done', source);
    data.lastUpdated = now();
    writeBriefing(data);
    things3Complete(text);
    markEmailRead(item);
    trackHealth('POST /api/complete-task', true);
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    trackHealth('POST /api/complete-task', false, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dismiss/:id — remove from dashboard + delete from Things 3
app.post('/api/dismiss/:id', (req, res) => {
  try {
    const data = readBriefing();
    const source = req.body?.source || 'api';
    const item = findItem(data, req.params.id);
    if (!item) {
      trackHealth('POST /api/dismiss', false, 'Item not found');
      return res.status(404).json({ error: 'Item not found' });
    }
    const text = item.text || '';
    const found = setItemStatus(data, req.params.id, 'dismissed', source);
    data.lastUpdated = now();
    writeBriefing(data);
    things3Delete(text);
    markEmailRead(item);
    trackHealth('POST /api/dismiss', true);
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    trackHealth('POST /api/dismiss', false, err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Draft helpers ---

function runCopilotDraft(item) {
  return new Promise((resolve, reject) => {
    const channel = item.channel || 'email';
    const sender = item.sender || 'unknown';
    const subject = item.text || '';
    const detail = item.detail || '';
    const prompt = `/draft-message Draft a reply to ${sender} about: ${subject}. ${detail ? 'Context: ' + detail : ''} Channel: ${channel}. Output ONLY the draft body text, no metadata.`;

    execFile('copilot', [
      '-p', prompt,
      '--allow-tool=workiq',
      '--allow-tool=outlook',
      '--allow-tool=gmail',
      '--allow-tool=hmbl-mail',
      '--allow-tool=memory',
      '--allow-tool=shell(cat)',
      '--deny-tool=shell(rm)',
      '--deny-tool=shell(git push)',
    ], { timeout: 120_000, cwd: join(__dirname, '..') }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

// POST /api/draft-reply — single draft via Copilot CLI
app.post('/api/draft-reply', async (req, res) => {
  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId required' });

  const data = readBriefing();
  if (!data) return res.status(404).json({ error: 'No briefing found' });

  // Find item across all sections
  let item;
  for (const section of ['inbox', 'carryOver', 'tasks']) {
    item = (data[section] || []).find(i => i.id === itemId);
    if (item) break;
  }
  if (!item) return res.status(404).json({ error: 'Item not found' });

  try {
    const draft = await runCopilotDraft(item);
    trackHealth('POST /api/draft-reply', true);
    res.json({ ok: true, itemId, draft, status: 'generated' });
  } catch (err) {
    trackHealth('POST /api/draft-reply', false, err.message);
    res.status(500).json({
      ok: false,
      itemId,
      error: err.message,
      status: 'failed'
    });
  }
});

// POST /api/draft-all — sequential drafts for all high-confidence items
app.post('/api/draft-all', async (req, res) => {
  const data = readBriefing();
  if (!data) return res.status(404).json({ error: 'No briefing found' });

  const candidates = (data.inbox || []).filter(
    i => i.status === 'open' && i.draftConfidence != null && i.draftConfidence >= 0.70
  );

  const drafts = [];
  for (const c of candidates) {
    try {
      const draft = await runCopilotDraft(c);
      drafts.push({
        itemId: c.id,
        sender: c.sender,
        subject: c.text,
        channel: c.channel,
        confidence: c.draftConfidence,
        draft,
        status: 'generated'
      });
    } catch (err) {
      drafts.push({
        itemId: c.id,
        sender: c.sender,
        subject: c.text,
        channel: c.channel,
        confidence: c.draftConfidence,
        draft: null,
        status: 'failed',
        error: err.message
      });
    }
  }
  const allOk = drafts.every(d => d.status === 'generated');
  trackHealth('POST /api/draft-all', allOk, allOk ? null : `${drafts.filter(d => d.status === 'failed').length} drafts failed`);
  res.json({ ok: true, count: drafts.length, drafts });
});

// --- Nudge helpers ---

function runCopilotNudge(entry) {
  return new Promise((resolve, reject) => {
    const person = entry.person || 'unknown';
    const item = entry.item || '';
    const detail = entry.detail || '';
    const channel = entry.channel || 'email';
    const daysOpen = entry.daysOpen != null ? entry.daysOpen : null;
    const stale = !!entry.stale;

    const aging = daysOpen != null
      ? `${daysOpen} day${daysOpen === 1 ? '' : 's'} open${stale ? ', flagged stale' : ''}`
      : (stale ? 'flagged stale' : 'recent');

    const prompt = [
      `/draft-message Draft a follow-up nudge to ${person} about: ${item}.`,
      detail ? `Context: ${detail}.` : '',
      `Channel: ${channel}. Aging: ${aging}.`,
      `Tone: warm, professional, growth mindset, never passive-aggressive. 2-4 sentences.`,
      `Reference the original context briefly so they don't have to search.`,
      `End with a P.S. (one short sentence) that semi-humorously discloses this reminder was drafted by Derek's AI assistant.`,
      `Output ONLY the message body text. No subject line, no metadata, no explanation.`,
    ].filter(Boolean).join(' ');

    execFile('copilot', [
      '-p', prompt,
      '--allow-tool=memory',
      '--allow-tool=shell(cat)',
      '--deny-tool=shell(rm)',
      '--deny-tool=shell(git push)',
    ], { timeout: 120_000, cwd: join(__dirname, '..') }, (err, stdout, _stderr) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

// POST /api/draft-nudge — generate a nudge draft for a waiting-on entry.
// Body: { person, item, detail, channel, daysOpen, stale } OR { index } to look up
// the entry from the current briefing's accountability.waitingOn array.
app.post('/api/draft-nudge', async (req, res) => {
  let entry = req.body || {};
  if (entry.index != null) {
    const data = readBriefing();
    const list = data?.accountability?.waitingOn || [];
    const found = list[entry.index];
    if (!found) return res.status(404).json({ error: 'waitingOn entry not found' });
    entry = { ...found, ...entry };
  }
  if (!entry.person || !entry.item) {
    return res.status(400).json({ error: 'person and item required' });
  }
  try {
    const draft = await runCopilotNudge(entry);
    trackHealth('POST /api/draft-nudge', true);
    res.json({ ok: true, draft, entry, status: 'generated' });
  } catch (err) {
    trackHealth('POST /api/draft-nudge', false, err.message);
    res.status(500).json({ ok: false, error: err.message, status: 'failed' });
  }
});

// POST /api/dismiss-waiting — hide a waiting-on-others entry from the dashboard.
// Body: { index } (preferred) OR { person, item } to match.
// This is a session-scoped dismissal: it mutates the briefing JSON only.
// assistant/context/waiting-on-others.md (generated from assistant.db) is the
// source of truth and is updated by atlas-db.py. Tomorrow's briefing will
// re-pull from the DB.
app.post('/api/dismiss-waiting', (req, res) => {
  try {
    const data = readBriefing();
    if (!data) return res.status(404).json({ error: 'No briefing found' });
    const acc = data.accountability || {};
    const list = Array.isArray(acc.waitingOn) ? acc.waitingOn : [];

    let removeIdx = -1;
    if (Number.isInteger(req.body?.index)) {
      removeIdx = req.body.index;
    } else if (req.body?.person && req.body?.item) {
      removeIdx = list.findIndex(w =>
        (w.person || '').toLowerCase() === req.body.person.toLowerCase() &&
        (w.item || '').toLowerCase() === req.body.item.toLowerCase());
    }
    if (removeIdx < 0 || removeIdx >= list.length) {
      return res.status(404).json({ error: 'waitingOn entry not found' });
    }

    const [removed] = list.splice(removeIdx, 1);
    acc.waitingOn = list;
    acc.waitingOnOthers = list.length;
    acc.stale = list.filter(w => w.stale).length;
    if (!Array.isArray(acc.dismissedWaiting)) acc.dismissedWaiting = [];
    acc.dismissedWaiting.push({
      person: removed.person, item: removed.item, dismissedAt: now(),
      source: req.body?.source || 'ui',
    });
    data.accountability = acc;
    data.lastUpdated = now();
    writeBriefing(data);

    trackHealth('POST /api/dismiss-waiting', true);
    res.json({ ok: true, removed, remaining: list.length });
  } catch (err) {
    trackHealth('POST /api/dismiss-waiting', false, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/complete-accountability — mark an overdue/approaching item done.
// Body: { type: 'overdue'|'approaching', index: number, source: 'ui'|... }
app.post('/api/complete-accountability', (req, res) => {
  try {
    const data = readBriefing();
    if (!data) return res.status(404).json({ error: 'No briefing found' });
    const acc = data.accountability || {};
    const { type, index, source } = req.body || {};
    if (!['overdue', 'approaching'].includes(type)) {
      return res.status(400).json({ error: 'type must be overdue or approaching' });
    }
    const list = acc[type] || [];
    if (!Number.isInteger(index) || index < 0 || index >= list.length) {
      return res.status(404).json({ error: 'Item not found at index' });
    }
    const [removed] = list.splice(index, 1);
    acc[type] = list;
    if (!Array.isArray(acc.completedItems)) acc.completedItems = [];
    acc.completedItems.push({
      type, text: typeof removed === 'string' ? removed : removed?.text || '',
      completedAt: now(), source: source || 'ui',
    });
    data.accountability = acc;
    data.lastUpdated = now();
    writeBriefing(data);
    trackHealth('POST /api/complete-accountability', true);
    res.json({ ok: true, removed, remaining: list.length });
  } catch (err) {
    trackHealth('POST /api/complete-accountability', false, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dismiss-accountability — dismiss an overdue/approaching item.
// Body: { type: 'overdue'|'approaching', index: number, source: 'ui'|... }
app.post('/api/dismiss-accountability', (req, res) => {
  try {
    const data = readBriefing();
    if (!data) return res.status(404).json({ error: 'No briefing found' });
    const acc = data.accountability || {};
    const { type, index, source } = req.body || {};
    if (!['overdue', 'approaching'].includes(type)) {
      return res.status(400).json({ error: 'type must be overdue or approaching' });
    }
    const list = acc[type] || [];
    if (!Number.isInteger(index) || index < 0 || index >= list.length) {
      return res.status(404).json({ error: 'Item not found at index' });
    }
    const [removed] = list.splice(index, 1);
    acc[type] = list;
    if (!Array.isArray(acc.dismissedItems)) acc.dismissedItems = [];
    acc.dismissedItems.push({
      type, text: typeof removed === 'string' ? removed : removed?.text || '',
      dismissedAt: now(), source: source || 'ui',
    });
    data.accountability = acc;
    data.lastUpdated = now();
    writeBriefing(data);
    trackHealth('POST /api/dismiss-accountability', true);
    res.json({ ok: true, removed, remaining: list.length });
  } catch (err) {
    trackHealth('POST /api/dismiss-accountability', false, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mark-read/:id — mark email as read via Graph API
app.post('/api/mark-read/:id', (req, res) => {
  try {
    const data = readBriefing();
    const item = findItem(data, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (!item.emailId) return res.json({ ok: false, message: 'No emailId on this item' });
    markEmailRead(item);
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/obligations?person=Name — open items involving a person
// Used by get-person-context.py and relationship-drift.py instead of regex-parsing markdown.
// Returns { derekOwes: [...items], theyOwe: [...items] } filtered by name match.
app.get('/api/obligations', (req, res) => {
  const person = (req.query.person || '').toLowerCase().trim();
  if (!person) return res.status(400).json({ error: 'person query param required' });

  const data = readBriefing();
  if (!data) return res.status(404).json({ error: 'No briefing found' });

  const tokens = person.split(/\s+/);
  const firstName = tokens[0];
  const lastName = tokens.length >= 2 ? tokens[tokens.length - 1] : null;

  function matches(item) {
    const text = (item.text + ' ' + (item.detail || '')).toLowerCase();
    if (text.includes(person)) return true;
    if (firstName && text.includes(firstName)) return true;
    if (lastName && text.includes(lastName)) return true;
    const sender = (item.sender || '').toLowerCase();
    if (sender.includes(person)) return true;
    if (firstName && sender.includes(firstName)) return true;
    if (lastName && sender.includes(lastName)) return true;
    return false;
  }

  // Items Derek owes (carryOver + tasks where item mentions the person)
  const derekOwes = [];
  for (const section of ['carryOver', 'tasks']) {
    for (const item of data[section] || []) {
      if (item.status === 'open' && matches(item)) {
        derekOwes.push({ id: item.id, text: item.text, detail: item.detail, section });
      }
    }
  }

  // Items they owe Derek (inbox items from that person still open)
  const theyOwe = [];
  for (const item of data.inbox || []) {
    if (item.status === 'open' && matches(item)) {
      theyOwe.push({ id: item.id, text: item.text, detail: item.detail, sender: item.sender });
    }
  }

  // Also check accountability.waitingOn if present
  if (data.accountability?.waitingOn) {
    for (const w of data.accountability.waitingOn) {
      if ((w.person || '').toLowerCase().includes(person) ||
          (lastName && (w.person || '').toLowerCase().includes(lastName))) {
        theyOwe.push({ id: null, text: w.item, detail: w.detail, sender: w.person });
      }
    }
  }

  trackHealth('GET /api/obligations', true);
  res.json({ person: req.query.person, derekOwes, theyOwe });
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`Briefing dashboard → http://localhost:${PORT}`);
});
