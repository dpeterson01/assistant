import express from 'express';
import { readFileSync, readdirSync, writeFileSync, renameSync, existsSync, mkdirSync, watch, statSync, realpathSync } from 'fs';
import { join, dirname, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';
import { execFile, execFileSync, spawn } from 'child_process';
import { startScheduler, stopScheduler, getStatus as getSchedulerStatus, enableTask, disableTask, triggerTask } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3141;
const HOST = '127.0.0.1'; // bind loopback only — single-machine tool, no LAN exposure

const DATA_DIR = join(__dirname, '..', 'data');
const BRIEFINGS_DIR = join(DATA_DIR, 'briefings');
const ARCHIVE_DIR = join(BRIEFINGS_DIR, 'archive');
const ASSISTANT_DIR = join(__dirname, '..');
const ATLAS_DB = join(DATA_DIR, 'state', 'assistant.db');

// --- Config loading -----------------------------------------------------------
// Reads config.yaml (simple subset parser) for categories and channels.
function loadConfig() {
  for (const candidate of [join(DATA_DIR, 'config.yaml'), join(ASSISTANT_DIR, 'data-templates', 'config.yaml')]) {
    if (!existsSync(candidate)) continue;
    try {
      const text = readFileSync(candidate, 'utf8');
      return parseSimpleYaml(text);
    } catch { /* fall through */ }
  }
  return {};
}

function parseSimpleYaml(text) {
  const result = {};
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) { i++; continue; }
    if (raw[0] === ' ' || raw[0] === '\t') { i++; continue; }
    const colonIdx = raw.indexOf(':');
    if (colonIdx === -1) { i++; continue; }
    const key = raw.slice(0, colonIdx).trim();
    const rest = stripYamlComment(raw.slice(colonIdx + 1).trim());
    if (rest) { result[key] = unquoteYaml(rest); i++; continue; }
    // Peek ahead for list or dict
    let j = i + 1;
    while (j < lines.length && (!lines[j].trim() || lines[j].trim().startsWith('#'))) j++;
    if (j < lines.length && lines[j].trimStart().startsWith('- ')) {
      const items = [];
      while (j < lines.length) {
        if (!lines[j].trim() || lines[j].trim().startsWith('#')) { j++; continue; }
        if (lines[j][0] !== ' ' && lines[j][0] !== '\t') break;
        if (lines[j].trimStart().startsWith('- ')) {
          const item = {};
          const entry = lines[j].trimStart().slice(2);
          const [ek, ev] = splitKV(entry);
          if (ek) item[ek] = unquoteYaml(stripYamlComment(ev));
          j++;
          while (j < lines.length) {
            if (!lines[j].trim() || lines[j].trim().startsWith('#')) { j++; continue; }
            if (lines[j].trimStart().startsWith('- ') || (lines[j][0] !== ' ' && lines[j][0] !== '\t')) break;
            const [ck, cv] = splitKV(lines[j].trim());
            if (ck) item[ck] = unquoteYaml(stripYamlComment(cv));
            j++;
          }
          items.push(item);
        } else { j++; }
      }
      result[key] = items; i = j; continue;
    } else {
      const sub = {};
      while (j < lines.length) {
        if (!lines[j].trim() || lines[j].trim().startsWith('#')) { j++; continue; }
        if (lines[j][0] !== ' ' && lines[j][0] !== '\t') break;
        const indent = lines[j].length - lines[j].trimStart().length;
        const [sk, sv] = splitKV(lines[j].trim());
        if (sk && sv) { sub[sk] = unquoteYaml(stripYamlComment(sv)); j++; }
        else if (sk && !sv) {
          const inner = {};
          j++;
          while (j < lines.length) {
            if (!lines[j].trim() || lines[j].trim().startsWith('#')) { j++; continue; }
            const ii = lines[j].length - lines[j].trimStart().length;
            if (ii <= indent) break;
            const [ik, iv] = splitKV(lines[j].trim());
            if (ik) inner[ik] = unquoteYaml(stripYamlComment(iv));
            j++;
          }
          sub[sk] = inner; continue;
        } else { j++; }
      }
      result[key] = sub; i = j; continue;
    }
  }
  return result;
}

function splitKV(s) {
  const idx = s.indexOf(':');
  if (idx === -1) return ['', ''];
  return [s.slice(0, idx).trim(), s.slice(idx + 1).trim()];
}

function unquoteYaml(s) {
  if (s.length >= 2 && s[0] === s[s.length - 1] && (s[0] === '"' || s[0] === "'")) return s.slice(1, -1);
  return s;
}

function stripYamlComment(s) {
  if (!s) return s;
  let inQuote = null;
  for (let i = 0; i < s.length; i++) {
    if ((s[i] === '"' || s[i] === "'") && !inQuote) inQuote = s[i];
    else if (s[i] === inQuote) inQuote = null;
    else if (s[i] === '#' && !inQuote) return s.slice(0, i).trimEnd();
  }
  return s;
}

const SITE_CONFIG = loadConfig();

function getConfigChannels() {
  return Array.isArray(SITE_CONFIG.channels) ? SITE_CONFIG.channels : [];
}

function getConfigCategories() {
  return Array.isArray(SITE_CONFIG.categories) ? SITE_CONFIG.categories : [
    { id: 'work', label: 'Work' }, { id: 'personal', label: 'Personal' },
  ];
}

// --- Meeting artifact lookup (recap / transcript) -----------------------------
// Reads atlas-db's meetings table to attach artifact links to each meeting in
// the briefing response. The dashboard turns these into RECAP / TRANSCRIPT
// pills that link out to the local recap markdown or the recording URL.
function getMeetingArtifacts(eventIds) {
  if (!eventIds || !eventIds.length || !existsSync(ATLAS_DB)) return new Map();
  // Build a parameterized IN clause via JSON: sqlite3 CLI doesn't bind params,
  // so escape ids defensively (event_id is matched against ITEM_ID_RE upstream
  // when present, but be safe).
  const safe = eventIds.filter(id => /^[\w.:@\/\-]{1,200}$/.test(id));
  if (!safe.length) return new Map();
  const list = safe.map(id => `'${id.replace(/'/g, "''")}'`).join(',');
  const sql = `SELECT event_id, brief_file, brief_status, recap_file, recap_status, recording_url, transcript_available, recap_summary FROM meetings WHERE event_id IN (${list});`;
  let raw = '';
  try {
    raw = execFileSync('sqlite3', ['-json', '-readonly', ATLAS_DB, sql], { encoding: 'utf-8', timeout: 2000 });
  } catch {
    return new Map();
  }
  if (!raw.trim()) return new Map();
  let rows;
  try { rows = JSON.parse(raw); } catch { return new Map(); }
  const out = new Map();
  for (const r of rows) out.set(r.event_id, r);
  return out;
}

function enrichMeetingsWithArtifacts(data) {
  if (!data || !Array.isArray(data.meetings) || !data.meetings.length) return data;
  const ids = data.meetings.map(m => m && m.id).filter(Boolean);
  const map = getMeetingArtifacts(ids);
  if (!map.size) return data;
  for (const m of data.meetings) {
    const row = map.get(m.id);
    if (!row) continue;
    if (row.recap_file) m.recapAvailable = true;
    if (row.brief_file) m.briefAvailable = true;
    if (row.recap_summary) m.recapSummary = row.recap_summary;
    if (row.recording_url) m.recordingUrl = row.recording_url;
    if (row.transcript_available) m.transcriptAvailable = true;
  }
  return data;
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, 'public')));

// --- Input validation helpers ---

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ITEM_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;

function isValidDate(s) {
  return typeof s === 'string' && DATE_RE.test(s) && !isNaN(Date.parse(s));
}

function isValidItemId(s) {
  return typeof s === 'string' && ITEM_ID_RE.test(s);
}

function sanitizeString(s, maxLen = 500) {
  if (typeof s !== 'string') return s;
  return s.slice(0, maxLen);
}

// Strip control chars and collapse whitespace before interpolating fields like
// sender/subject into LLM prompts. Defends against control-char prompt steering
// and keeps a single-line prompt single-line.
function promptSafe(s, maxLen = 500) {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

// Centralized channel → MCP mail tool map. Built from config, with fallbacks.
const MAIL_TOOL_BY_CHANNEL = Object.fromEntries(
  getConfigChannels()
    .filter(ch => ch.mcp_prefix)
    .map(ch => [ch.id, ch.mcp_prefix])
);
// Ensure generic fallbacks exist
if (!MAIL_TOOL_BY_CHANNEL.email) MAIL_TOOL_BY_CHANNEL.email = MAIL_TOOL_BY_CHANNEL['outlook-work'] || 'mailtools';
function mailToolFor(channel) { return MAIL_TOOL_BY_CHANNEL[channel] || MAIL_TOOL_BY_CHANNEL['outlook-work'] || 'mailtools'; }

// --- LLM prompt templates ---
//
// Templates live in dashboard/prompts/*.md so prompt edits ship as one-file
// diffs and the golden-prompt regression test (tests/golden-prompts.test.js)
// can detect drift. Substitution is intentionally minimal: {{var}} → values[var].
// Missing keys render empty. Callers are responsible for sanitizing inputs
// (promptSafe / sanitizeString) before passing them in.

const PROMPTS_DIR = join(__dirname, 'prompts');
const PROMPT_FILES = ['fetch-message', 'save-draft', 'draft-reply', 'draft-nudge'];
const PROMPTS = Object.fromEntries(
  PROMPT_FILES.map(name => [name, readFileSync(join(PROMPTS_DIR, `${name}.md`), 'utf8')])
);

function renderPrompt(name, values = {}) {
  const tpl = PROMPTS[name];
  if (!tpl) throw new Error(`Unknown prompt template: ${name}`);
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    values[k] != null ? String(values[k]) : ''
  ).trim();
}

// --- File helpers ---

function briefingPath(date) {
  if (date) {
    // Check top-level first, then archive
    const top = join(BRIEFINGS_DIR, `${date}_daily_brief.json`);
    if (existsSync(top)) return top;
    const archived = join(ARCHIVE_DIR, `${date}_daily_brief.json`);
    if (existsSync(archived)) return archived;
    return top; // default to top-level for new writes
  }
  // Latest: only look in top-level (archive contains old briefings)
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
  // Atomic write: stage to a sibling tmp file then rename. A crash mid-stringify
  // or mid-write leaves the original intact instead of corrupting it.
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, p);
  // The fs.watch in the SSE block will also fire; the debounce coalesces.
  // Calling scheduleBroadcast directly guarantees at-least-one push even on
  // filesystems where watch is unreliable (e.g., some network mounts).
  if (typeof scheduleBroadcast === 'function') scheduleBroadcast('write');
}

// --- Per-date write mutex ---
// All endpoints that read-modify-write the briefing JSON serialize through
// this lock. Without it, two clicks landing within milliseconds (or the cron
// PATCH overlapping a UI action) would race and silently clobber each other.
const writeLocks = new Map(); // date -> Promise chain tail
function withBriefingLock(date, fn) {
  const key = date || '__latest__';
  const prev = writeLocks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => fn());
  writeLocks.set(key, next);
  // Clean up the map entry once this turn settles (only if still the tail).
  next.finally(() => { if (writeLocks.get(key) === next) writeLocks.delete(key); });
  return next;
}

function now() { return new Date().toISOString(); }

// --- Health tracking ---
// Tracks last call result for each endpoint. Stored in-memory (resets on restart).
const health = {};

function trackHealth(name, ok, detail) {
  health[name] = { ok, detail: detail || null, at: now() };
}

// GET /api/config — expose categories and channels to the frontend
app.get('/api/config', (_req, res) => {
  res.json({
    categories: getConfigCategories(),
    channels: getConfigChannels().map(ch => ({ id: ch.id, label: ch.label, category: ch.category, deep_link: ch.deep_link, search_link: ch.search_link })),
  });
});

// GET /api/health — stoplight status for all tracked operations
app.get('/api/health', (_req, res) => {
  const allOk = Object.values(health).every(h => h.ok);
  res.json({ allOk, lastChecked: now(), endpoints: health, queueDepth: sideEffectQueue.length, regenerating: !!regenProc });
});

// GET /api/automation-health — scheduled job status from health-check.sh
app.get('/api/automation-health', (_req, res) => {
  const script = join(__dirname, '..', 'automation', 'scripts', 'health-check.sh');
  execFile('/bin/zsh', [script, '--json'], { timeout: 15_000 }, (err, stdout, _stderr) => {
    if (err) {
      trackHealth('GET /api/automation-health', false, err.message);
      return res.status(500).json({ error: err.message });
    }
    try {
      const jobs = JSON.parse(stdout);
      const allOk = jobs.every(j => j.today === 'ok' || j.today === 'no-log' || j.today === 'ran');
      const errors = jobs.filter(j => j.today === 'error').length;
      trackHealth('GET /api/automation-health', true);
      res.json({ allOk, errors, jobs, checkedAt: now() });
    } catch (parseErr) {
      trackHealth('GET /api/automation-health', false, 'JSON parse error');
      res.status(500).json({ error: 'Failed to parse health-check output' });
    }
  });
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
    HOME: process.env.HOME,
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:' + (process.env.HOME || '') + '/.local/bin',
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

// --- Run any scheduled job by script name ---
// POST /api/jobs/run { script: "morning-briefing.sh" }
// Validates the script name against a strict allowlist (filenames only, no paths).
// Runs the script in the background and returns immediately.

const SCRIPTS_DIR = join(__dirname, '..', 'automation', 'scripts');
const ALLOWED_SCRIPTS = new Set([
  'morning-briefing.sh',
  'briefing-sync.sh',
  'meeting-sweep.sh',
  'meeting-recap-sweep.sh',
  'end-of-day-reminder.sh',
  'end-of-day-auto.sh',
  'weekly-review.sh',
  'auto-draft-inbox.sh',
]);

// Track running jobs so we don't double-launch
const runningJobs = new Map(); // script -> { proc, startedAt }

app.post('/api/jobs/run', (req, res) => {
  const { script } = req.body || {};
  if (!script || typeof script !== 'string') {
    return res.status(400).json({ error: 'Missing script field' });
  }
  // Strict validation: must be in allowlist (no path traversal possible)
  if (!ALLOWED_SCRIPTS.has(script)) {
    return res.status(403).json({ error: `Script not allowed: ${script}` });
  }
  if (runningJobs.has(script)) {
    const running = runningJobs.get(script);
    return res.status(409).json({ error: 'Already running', pid: running.proc.pid, startedAt: running.startedAt });
  }

  const scriptPath = join(SCRIPTS_DIR, script);
  const env = {
    ...process.env,
    ATLAS_FORCE_REGEN: '1',
    HOME: process.env.HOME,
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:' + (process.env.HOME || '') + '/.local/bin',
  };

  const proc = execFile('/bin/zsh', [scriptPath], { env, timeout: 720_000, cwd: SCRIPTS_DIR }, (err) => {
    const ok = !err;
    runningJobs.delete(script);
    trackHealth(`job:${script}`, ok, ok ? `completed ${now()}` : `failed: ${err.message}`);
    console.log(`[job:${script}] finished: ${ok ? 'success' : err.message}`);
    broadcast('job-done', { script, ok, at: now() });
  });

  proc.unref?.();
  const startedAt = now();
  runningJobs.set(script, { proc, startedAt });
  trackHealth(`job:${script}`, true, `started ${startedAt}`);
  broadcast('job-started', { script, at: startedAt });
  console.log(`[job:${script}] started, pid=${proc.pid}`);
  res.json({ status: 'started', script, pid: proc.pid });
});

// GET /api/jobs/status — which jobs are currently running
app.get('/api/jobs/status', (_req, res) => {
  const running = {};
  for (const [script, { proc, startedAt }] of runningJobs) {
    running[script] = { pid: proc.pid, startedAt };
  }
  res.json({ running });
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

// --- Undo buffer ---
// Stores recent status changes so they can be reverted within a grace period.
// Each entry: { id, previousStatus, previousSource, section, timestamp }
const UNDO_GRACE_MS = 15_000; // 15 seconds
const undoBuffer = [];

function pruneUndoBuffer() {
  const cutoff = Date.now() - UNDO_GRACE_MS;
  while (undoBuffer.length > 0 && undoBuffer[0].timestamp < cutoff) {
    undoBuffer.shift();
  }
}

function recordUndo(item, section) {
  pruneUndoBuffer();
  undoBuffer.push({
    id: item.id,
    previousStatus: item.status,
    previousSource: item.source,
    section,
    timestamp: Date.now(),
  });
}

function setItemStatus(data, id, status, source = 'api') {
  const ts = now();
  for (const section of ['carryOver', 'inbox', 'tasks']) {
    const list = data[section];
    if (!list) continue;
    const item = list.find(i => i.id === id);
    if (item) {
      recordUndo(item, section);
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
  if (req.query.date && !isValidDate(req.query.date)) {
    return res.status(400).json({ error: 'Invalid date format (expected YYYY-MM-DD)' });
  }
  const data = readBriefing(req.query.date);
  if (!data) {
    trackHealth('GET /api/briefing', false, 'No briefing found');
    return res.status(404).json({ error: 'No briefing found' });
  }
  enrichMeetingsWithArtifacts(data);
  trackHealth('GET /api/briefing', true);
  res.json(data);
});

// GET /api/meeting-artifact?event_id=...&kind=recap|brief
// Streams a local meeting recap or brief markdown file. The path is read from
// atlas-db so the user can't request arbitrary files; we additionally validate
// that the resolved path lives under the assistant directory.
app.get('/api/meeting-artifact', (req, res) => {
  const eventId = String(req.query.event_id || '');
  const kind = String(req.query.kind || '');
  if (!/^[\w.:@\/\-]{1,200}$/.test(eventId)) return res.status(400).json({ error: 'Invalid event_id' });
  if (kind !== 'recap' && kind !== 'brief') return res.status(400).json({ error: 'Invalid kind' });
  const map = getMeetingArtifacts([eventId]);
  const row = map.get(eventId);
  if (!row) return res.status(404).json({ error: 'Meeting not found' });
  const filePath = kind === 'recap' ? row.recap_file : row.brief_file;
  if (!filePath) return res.status(404).json({ error: `No ${kind} file recorded` });
  let abs;
  try {
    abs = realpathSync(resolvePath(filePath));
  } catch {
    return res.status(404).json({ error: 'File not found on disk' });
  }
  // Allowed roots: anything inside the assistant directory or the linked
  // atlas-data directory. Resolve symlinks to compare canonically.
  let assistantReal, dataReal;
  try { assistantReal = realpathSync(ASSISTANT_DIR); } catch { assistantReal = ASSISTANT_DIR; }
  try { dataReal = realpathSync(DATA_DIR); } catch { dataReal = DATA_DIR; }
  if (!abs.startsWith(assistantReal + '/') && !abs.startsWith(dataReal + '/')) {
    return res.status(403).json({ error: 'Path outside allowed roots' });
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(readFileSync(abs, 'utf-8'));
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
  const patch = req.body;
  if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'Request body must be a JSON object' });
  if (patch.date && !isValidDate(patch.date)) return res.status(400).json({ error: 'Invalid date format (expected YYYY-MM-DD)' });

  withBriefingLock(patch.date, async () => {
    const data = readBriefing(patch.date);
    if (!data) return res.status(404).json({ error: 'No briefing found for date' });
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
  }).catch(err => {
    trackHealth('PATCH /api/briefing', false, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

// POST /api/complete-task/:id — mark done in JSON + complete in Things 3
app.post('/api/complete-task/:id', (req, res) => {
  if (!isValidItemId(req.params.id)) return res.status(400).json({ error: 'Invalid item id' });
  withBriefingLock(null, async () => {
    const data = readBriefing();
    const source = req.body?.source || 'api';
    const item = findItem(data, req.params.id);
    if (!item) {
      trackHealth('POST /api/complete-task', false, 'Item not found');
      return res.status(404).json({ error: 'Item not found' });
    }
    const text = item.text || '';
    setItemStatus(data, req.params.id, 'done', source);

    // Cross-complete: remove matching accountability overdue/approaching entry
    // Uses substring matching: if either text starts with the other (after
    // lowercasing and trimming), it's considered a match. This handles cases
    // where inbox text includes extra detail (e.g. "Review X submission
    // (manager comments)") while accountability just says "Review X".
    const acc = data.accountability || {};
    const textLower = text.toLowerCase().trim();
    for (const aType of ['overdue', 'approaching']) {
      const aList = acc[aType] || [];
      const aIdx = aList.findIndex(s => {
        const core = (typeof s === 'string'
          ? (s.includes('—') ? s.split('—')[0].trim() : s.trim())
          : (s.text || '')).toLowerCase();
        return core === textLower || textLower.startsWith(core) || core.startsWith(textLower);
      });
      if (aIdx !== -1) {
        const [removed] = aList.splice(aIdx, 1);
        if (!Array.isArray(acc.completedItems)) acc.completedItems = [];
        acc.completedItems.push({
          type: aType, text: typeof removed === 'string' ? removed : removed?.text || '',
          completedAt: now(), source: source || 'ui',
        });
        data.accountability = acc;
        break;
      }
    }

    data.lastUpdated = now();
    writeBriefing(data);
    things3Complete(text);
    markEmailRead(item);
    trackHealth('POST /api/complete-task', true);
    res.json({ ok: true, id: req.params.id });
  }).catch(err => {
    trackHealth('POST /api/complete-task', false, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

// POST /api/dismiss/:id — remove from dashboard + delete from Things 3
app.post('/api/dismiss/:id', (req, res) => {
  if (!isValidItemId(req.params.id)) return res.status(400).json({ error: 'Invalid item id' });
  withBriefingLock(null, async () => {
    const data = readBriefing();
    const source = req.body?.source || 'api';
    const item = findItem(data, req.params.id);
    if (!item) {
      trackHealth('POST /api/dismiss', false, 'Item not found');
      return res.status(404).json({ error: 'Item not found' });
    }
    const text = item.text || '';
    setItemStatus(data, req.params.id, 'dismissed', source);
    data.lastUpdated = now();
    writeBriefing(data);
    things3Delete(text);
    markEmailRead(item);
    trackHealth('POST /api/dismiss', true);
    res.json({ ok: true, id: req.params.id });
  }).catch(err => {
    trackHealth('POST /api/dismiss', false, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

// POST /api/undo/:id — revert the last status change within the grace period.
// Only works if setItemStatus was called within the last UNDO_GRACE_MS.
app.post('/api/undo/:id', (req, res) => {
  if (!isValidItemId(req.params.id)) return res.status(400).json({ error: 'Invalid item id' });
  withBriefingLock(null, async () => {
    pruneUndoBuffer();
    // Find the most recent undo entry for this id (search from end)
    const idx = undoBuffer.findLastIndex(e => e.id === req.params.id);
    if (idx === -1) {
      return res.status(410).json({ error: 'Undo window expired or no recent change for this item' });
    }
    const entry = undoBuffer.splice(idx, 1)[0];
    const data = readBriefing();
    if (!data) return res.status(404).json({ error: 'No briefing found' });
    const item = findItem(data, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    item.status = entry.previousStatus;
    item.source = entry.previousSource;
    item.updatedAt = now();
    delete item.syncPending;
    data.lastUpdated = now();
    writeBriefing(data);

    trackHealth('POST /api/undo', true);
    res.json({ ok: true, id: req.params.id, restoredStatus: entry.previousStatus });
  }).catch(err => {
    trackHealth('POST /api/undo', false, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

// POST /api/sync-things3 — pull Things 3 completed-today and mark matching
// briefing items as done. Returns the list of items that were updated.
app.post('/api/sync-things3', (_req, res) => {
  withBriefingLock(null, async () => {
    const data = readBriefing();
    if (!data) {
      trackHealth('POST /api/sync-things3', false, 'No briefing');
      return res.status(404).json({ error: 'No briefing found' });
    }

    // 1. Get completed tasks from Things 3
    let completedRaw;
    try {
      completedRaw = execFileSync(
        join(THINGS3_DIR, 'completed-today.sh'), [],
        { timeout: 15000, encoding: 'utf-8' }
      );
    } catch (err) {
      trackHealth('POST /api/sync-things3', false, err.message);
      return res.status(502).json({ error: 'Failed to read Things 3: ' + err.message });
    }

    const completedNames = completedRaw
      .split('\n')
      .filter(Boolean)
      .map(line => {
        // Format: "project | task name" — extract task name
        const parts = line.split('|');
        return (parts.length > 1 ? parts.slice(1).join('|') : parts[0]).trim().toLowerCase();
      })
      .filter(Boolean);

    if (!completedNames.length) {
      trackHealth('POST /api/sync-things3', true, 'No completions found');
      return res.json({ ok: true, synced: [], message: 'No completed tasks in Things 3 today' });
    }

    // 2. Match against open briefing items
    const synced = [];
    for (const section of ['carryOver', 'inbox', 'tasks']) {
      for (const item of (data[section] || [])) {
        if (item.status !== 'open') continue;
        const text = (item.text || '').toLowerCase().trim();
        if (!text) continue;
        // Match if Things 3 name starts with briefing text or vice versa
        const matched = completedNames.some(cn =>
          cn === text || cn.startsWith(text) || text.startsWith(cn)
          || cn.includes(text) || text.includes(cn)
        );
        if (matched) {
          item.status = 'done';
          item.updatedAt = now();
          item.source = 'things3-sync';
          synced.push({ id: item.id, text: item.text, section });
        }
      }
    }

    if (synced.length > 0) {
      data.lastUpdated = now();
      data.updateCount = (data.updateCount || 0) + synced.length;
      writeBriefing(data);
    }

    trackHealth('POST /api/sync-things3', true, `Synced ${synced.length} items`);
    res.json({ ok: true, synced, count: synced.length });
  }).catch(err => {
    trackHealth('POST /api/sync-things3', false, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

// --- Message fetch helper ---

function runCopilotFetchMessage(item) {
  return new Promise((resolve, reject) => {
    const channel = item.channel || 'email';
    const emailId = item.emailId || '';
    const sender = promptSafe(item.sender || 'unknown', 200);
    const subject = promptSafe(item.text || '', 300);

    const prompt = renderPrompt('fetch-message', {
      sender,
      subject,
      channel,
      emailIdLine: emailId ? `Email ID: ${promptSafe(emailId, 200)}.` : '',
    });

    const mailTool = mailToolFor(channel);

    execFile('copilot', [
      '-p', prompt,
      `--allow-tool=${mailTool}`,
      '--allow-tool=memory',
      '--allow-tool=shell(cat)',
      '--deny-tool=shell(rm)',
      '--deny-tool=shell(git push)',
    ], { timeout: 60_000, cwd: join(__dirname, '..') }, (err, stdout, _stderr) => {
      if (err) return reject(err);
      const body = stdout.trim();
      if (body === 'FETCH_FAILED' || !body) {
        return reject(new Error('Could not fetch original message'));
      }
      resolve(body);
    });
  });
}

// GET /api/message/:itemId — fetch the original message body
app.get('/api/message/:itemId', async (req, res) => {
  if (!isValidItemId(req.params.itemId)) return res.status(400).json({ error: 'Invalid item id' });

  const data = readBriefing();
  if (!data) return res.status(404).json({ error: 'No briefing found' });

  let item;
  for (const section of ['inbox', 'carryOver', 'tasks']) {
    item = (data[section] || []).find(i => i.id === req.params.itemId);
    if (item) break;
  }
  if (!item) return res.status(404).json({ error: 'Item not found' });

  try {
    const body = await runCopilotFetchMessage(item);
    trackHealth('GET /api/message', true);
    res.json({
      ok: true,
      itemId: req.params.itemId,
      sender: item.sender || '',
      subject: item.text || '',
      channel: item.channel || 'email',
      receivedAt: item.receivedAt || item.addedAt || '',
      body,
    });
  } catch (err) {
    trackHealth('GET /api/message', false, err.message);
    // Return item metadata even on fetch failure so the modal can show context
    res.status(200).json({
      ok: false,
      itemId: req.params.itemId,
      sender: item.sender || '',
      subject: item.text || '',
      channel: item.channel || 'email',
      receivedAt: item.receivedAt || item.addedAt || '',
      detail: item.detail || '',
      body: null,
      error: err.message,
    });
  }
});

// --- Save-draft helper ---

function runCopilotSaveDraft(channel, to, subject, body) {
  return new Promise((resolve, reject) => {
    const mailTool = mailToolFor(channel);
    const safeTo = promptSafe(to, 200);
    const safeSubject = promptSafe(subject, 300);

    const prompt = renderPrompt('save-draft', {
      to: safeTo,
      subject: safeSubject,
      channel,
      body,
      mailTool,
    });

    execFile('copilot', [
      '-p', prompt,
      `--allow-tool=${mailTool}`,
      '--allow-tool=memory',
      '--deny-tool=shell(rm)',
      '--deny-tool=shell(git push)',
    ], { timeout: 60_000, cwd: join(__dirname, '..') }, (err, stdout, _stderr) => {
      if (err) return reject(err);
      const result = stdout.trim();
      if (result.startsWith('FAILED')) return reject(new Error(result));
      resolve(result);
    });
  });
}

// POST /api/save-draft — save a composed reply as a draft in the mail client
app.post('/api/save-draft', async (req, res) => {
  const { itemId, body: draftBody } = req.body;
  if (!itemId || !draftBody) return res.status(400).json({ error: 'itemId and body required' });
  if (!isValidItemId(itemId)) return res.status(400).json({ error: 'Invalid item id' });

  const data = readBriefing();
  if (!data) return res.status(404).json({ error: 'No briefing found' });

  let item;
  for (const section of ['inbox', 'carryOver', 'tasks']) {
    item = (data[section] || []).find(i => i.id === itemId);
    if (item) break;
  }
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const channel = item.channel || 'email';
  const to = item.sender || '';
  const subject = item.text || '';

  try {
    await runCopilotSaveDraft(channel, to, subject, sanitizeString(draftBody, 5000));
    trackHealth('POST /api/save-draft', true);
    res.json({ ok: true, itemId, status: 'saved' });
  } catch (err) {
    trackHealth('POST /api/save-draft', false, err.message);
    res.status(500).json({ ok: false, itemId, error: err.message, status: 'failed' });
  }
});

// --- Draft helpers ---

function runCopilotDraft(item, { stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const channel = item.channel || 'email';
    const sender = promptSafe(item.sender || 'unknown', 200);
    const subject = promptSafe(item.text || '', 300);
    const detail = promptSafe(item.detail || '', 800);
    const prompt = renderPrompt('draft-reply', {
      sender,
      subject,
      channel,
      contextLine: detail ? `Context: ${detail}` : '',
    });

    // Build allow-tool list from configured channel MCP prefixes
    const mailPrefixes = [...new Set(getConfigChannels().filter(ch => ch.mcp_prefix).map(ch => ch.mcp_prefix))];
    const args = [
      '-p', prompt,
      '--allow-tool=workiq',
      ...mailPrefixes.map(p => `--allow-tool=${p}`),
      '--allow-tool=memory',
      '--allow-tool=shell(cat)',
      '--deny-tool=shell(rm)',
      '--deny-tool=shell(git push)',
    ];
    const opts = { cwd: join(__dirname, '..') };

    // When stream=true, spawn so we can forward stdout chunks to SSE clients
    // as `draft-progress` events keyed by item.id. The promise still resolves
    // with the full final text so the HTTP response is unchanged.
    if (stream && item.id) {
      const proc = spawn('copilot', args, opts);
      let buf = '';
      const timer = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch {}
        reject(new Error('copilot draft timed out after 120s'));
      }, 120_000);

      proc.stdout.on('data', chunk => {
        buf += chunk.toString();
        broadcast('draft-progress', { itemId: item.id, text: buf });
      });
      proc.on('error', err => { clearTimeout(timer); reject(err); });
      proc.on('close', code => {
        clearTimeout(timer);
        const final = buf.trim();
        if (code !== 0) return reject(new Error(`copilot exited ${code}`));
        broadcast('draft-ready', { itemId: item.id, text: final });
        resolve(final);
      });
      return;
    }

    execFile('copilot', args, { ...opts, timeout: 120_000 }, (err, stdout, _stderr) => {
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
    const draft = await runCopilotDraft(item, { stream: true });
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

// POST /api/draft-all — parallel drafts (concurrency cap) for high-confidence items
app.post('/api/draft-all', async (req, res) => {
  const data = readBriefing();
  if (!data) return res.status(404).json({ error: 'No briefing found' });

  const candidates = (data.inbox || []).filter(
    i => i.status === 'open' && i.draftConfidence != null && i.draftConfidence >= 0.70
  );

  // Bounded concurrency to avoid hammering MCP tools / Copilot CLI process pool.
  const CONCURRENCY = 2;
  const drafts = new Array(candidates.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= candidates.length) return;
      const c = candidates[idx];
      try {
        const draft = await runCopilotDraft(c);
        drafts[idx] = {
          itemId: c.id, sender: c.sender, subject: c.text, channel: c.channel,
          confidence: c.draftConfidence, draft, status: 'generated',
        };
      } catch (err) {
        drafts[idx] = {
          itemId: c.id, sender: c.sender, subject: c.text, channel: c.channel,
          confidence: c.draftConfidence, draft: null, status: 'failed', error: err.message,
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker));

  const allOk = drafts.every(d => d.status === 'generated');
  trackHealth('POST /api/draft-all', allOk, allOk ? null : `${drafts.filter(d => d.status === 'failed').length} drafts failed`);
  res.json({ ok: true, count: drafts.length, drafts });
});

// --- Nudge helpers ---

function runCopilotNudge(entry) {
  return new Promise((resolve, reject) => {
    const person = promptSafe(entry.person || 'unknown', 200);
    const item = promptSafe(entry.item || '', 400);
    const detail = promptSafe(entry.detail || '', 800);
    const channel = entry.channel || 'email';
    const daysOpen = entry.daysOpen != null ? entry.daysOpen : null;
    const stale = !!entry.stale;

    const aging = daysOpen != null
      ? `${daysOpen} day${daysOpen === 1 ? '' : 's'} open${stale ? ', flagged stale' : ''}`
      : (stale ? 'flagged stale' : 'recent');

    const prompt = renderPrompt('draft-nudge', {
      person,
      item,
      channel,
      aging,
      contextLine: detail ? `Context: ${detail}.` : '',
    });

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
// assistant/data/context/waiting-on-others.md (generated from assistant.db) is the
// source of truth and is updated by atlas-db.py. Tomorrow's briefing will
// re-pull from the DB.
app.post('/api/dismiss-waiting', (req, res) => {
  withBriefingLock(null, async () => {
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
  }).catch(err => {
    trackHealth('POST /api/dismiss-waiting', false, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

// POST /api/complete-accountability — mark an overdue/approaching item done.
// Body: { type: 'overdue'|'approaching', index: number, source: 'ui'|... }
app.post('/api/complete-accountability', (req, res) => {
  withBriefingLock(null, async () => {
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
    const removedText = typeof removed === 'string' ? removed : removed?.text || '';
    acc.completedItems.push({
      type, text: removedText,
      completedAt: now(), source: source || 'ui',
    });

    // Cross-complete: mark matching carryOver/tasks item as done
    const coreText = removedText.includes('—') ? removedText.split('—')[0].trim() : removedText.trim();
    for (const section of ['carryOver', 'tasks']) {
      const items = data[section] || [];
      const match = items.find(i => i.status !== 'done' && i.status !== 'dismissed'
        && (i.text || '').toLowerCase().trim() === coreText.toLowerCase());
      if (match) {
        match.status = 'done';
        match.updatedAt = now();
        match.source = source || 'ui';
        match.syncPending = true;
        break;
      }
    }

    data.accountability = acc;
    data.lastUpdated = now();
    writeBriefing(data);
    trackHealth('POST /api/complete-accountability', true);
    res.json({ ok: true, removed, remaining: list.length });
  }).catch(err => {
    trackHealth('POST /api/complete-accountability', false, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

// POST /api/dismiss-accountability — dismiss an overdue/approaching item.
// Body: { type: 'overdue'|'approaching', index: number, source: 'ui'|... }
app.post('/api/dismiss-accountability', (req, res) => {
  withBriefingLock(null, async () => {
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
  }).catch(err => {
    trackHealth('POST /api/dismiss-accountability', false, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
});

// POST /api/mark-read/:id — mark email as read via Graph API
app.post('/api/mark-read/:id', (req, res) => {
  if (!isValidItemId(req.params.id)) return res.status(400).json({ error: 'Invalid item id' });
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
// Returns { userOwes: [...items], theyOwe: [...items] } filtered by name match.
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

  // Items the user owes (carryOver + tasks where item mentions the person)
  const userOwes = [];
  for (const section of ['carryOver', 'tasks']) {
    for (const item of data[section] || []) {
      if (item.status === 'open' && matches(item)) {
        userOwes.push({ id: item.id, text: item.text, detail: item.detail, section });
      }
    }
  }

  // Items they owe the user (inbox items from that person still open)
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
  res.json({ person: req.query.person, userOwes, theyOwe });
});

// --- Scheduler API ---

// GET /api/scheduler — full status of all scheduled jobs
app.get('/api/scheduler', (_req, res) => {
  res.json({ jobs: getSchedulerStatus() });
});

// POST /api/scheduler/:id/enable
app.post('/api/scheduler/:id/enable', (req, res) => {
  const result = enableTask(req.params.id);
  if (result.error) return res.status(404).json(result);
  broadcast('scheduler', { action: 'enabled', task: req.params.id });
  res.json(result);
});

// POST /api/scheduler/:id/disable
app.post('/api/scheduler/:id/disable', (req, res) => {
  const result = disableTask(req.params.id);
  if (result.error) return res.status(404).json(result);
  broadcast('scheduler', { action: 'disabled', task: req.params.id });
  res.json(result);
});

// POST /api/scheduler/:id/trigger — manually fire a job now
app.post('/api/scheduler/:id/trigger', (req, res) => {
  const result = triggerTask(req.params.id, {
    onStart: (task, info) => broadcast('job-started', { task: task.id, ...info }),
    onEnd: (task, info) => broadcast('job-done', { task: task.id, ...info }),
  });
  if (result.error) {
    const status = result.pid ? 409 : 404;
    return res.status(status).json(result);
  }
  res.json(result);
});

// --- Start ---
app.listen(PORT, HOST, () => {
  console.log(`Briefing dashboard → http://${HOST}:${PORT}`);

  // Start the scheduler after the server is listening
  const { started, skipped } = startScheduler({
    onStart: (task, info) => broadcast('job-started', { task: task.id, ...info }),
    onEnd: (task, info) => broadcast('job-done', { task: task.id, ...info }),
  });
  console.log(`[scheduler] ${started} jobs active, ${skipped} skipped`);
});

// Reap any in-flight regenerate child on shutdown so we don't orphan it.
function shutdown(sig) {
  stopScheduler();
  if (regenProc) {
    try { regenProc.kill('SIGTERM'); } catch { /* already gone */ }
  }
  console.log(`[server] ${sig} received, exiting`);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
