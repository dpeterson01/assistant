// scheduler.js — node-cron scheduler that replaces launchd for Atlas automation.
//
// Reads manifest.json, converts schedules to cron expressions, spawns each
// task's shell script on schedule, and writes run status back to the manifest.
// The server imports this module and wires up API endpoints for control.

import cron from 'node-cron';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, '..', 'automation', 'manifest.json');
const SCRIPTS_DIR = join(__dirname, '..', 'automation', 'scripts');

// --- Schedule parsing ---------------------------------------------------------
// Converts manifest schedule strings to cron expressions.
// Supported formats:
//   "M-F 6:30 AM"                    → "30 6 * * 1-5"
//   "M-F 8:00 PM"                    → "0 20 * * 1-5"
//   "Sun 9:00 AM"                    → "0 9 * * 0"
//   "M-F every 15 min, 7 AM - 6 PM" → "*/15 7-17 * * 1-5"
//   "M-F every 30 min, 8 AM - 6 PM" → "*/30 8-17 * * 1-5"
//
// The shell scripts already have their own time-of-day guards, so the interval
// schedules here just need to fire during the right window. The scripts
// themselves will exit early if outside their specific window.

function parseScheduleToCron(schedule) {
  if (!schedule || typeof schedule !== 'string') return null;

  // "M-F every N min, H AM - H PM"
  const intervalMatch = schedule.match(
    /^(M-F|Mon-Fri)\s+every\s+(\d+)\s+min(?:utes?)?,\s*(\d{1,2})\s*(AM|PM)\s*-\s*(\d{1,2})\s*(AM|PM)$/i
  );
  if (intervalMatch) {
    const mins = intervalMatch[2];
    const startH = to24(parseInt(intervalMatch[3]), intervalMatch[4]);
    const endH = to24(parseInt(intervalMatch[5]), intervalMatch[6]);
    // Cron hour range is inclusive, but we want "up to but not including" endH.
    // The shell script's own guard handles the exact cutoff.
    return `*/${mins} ${startH}-${endH - 1} * * 1-5`;
  }

  // "M-F H:MM AM/PM"
  const weekdayMatch = schedule.match(
    /^(M-F|Mon-Fri)\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i
  );
  if (weekdayMatch) {
    const hour = to24(parseInt(weekdayMatch[2]), weekdayMatch[4]);
    const min = parseInt(weekdayMatch[3]);
    return `${min} ${hour} * * 1-5`;
  }

  // "Sun H:MM AM/PM"
  const sunMatch = schedule.match(
    /^Sun(?:day)?\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i
  );
  if (sunMatch) {
    const hour = to24(parseInt(sunMatch[1]), sunMatch[3]);
    const min = parseInt(sunMatch[2]);
    return `${min} ${hour} * * 0`;
  }

  // "Sat H:MM AM/PM"
  const satMatch = schedule.match(
    /^Sat(?:urday)?\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i
  );
  if (satMatch) {
    const hour = to24(parseInt(satMatch[1]), satMatch[3]);
    const min = parseInt(satMatch[2]);
    return `${min} ${hour} * * 6`;
  }

  console.warn(`[scheduler] Could not parse schedule: "${schedule}"`);
  return null;
}

function to24(hour, ampm) {
  const upper = ampm.toUpperCase();
  if (upper === 'AM' && hour === 12) return 0;
  if (upper === 'PM' && hour !== 12) return hour + 12;
  return hour;
}

// --- Manifest I/O -------------------------------------------------------------

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
}

function writeManifest(manifest) {
  const tmp = `${MANIFEST_PATH}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  renameSync(tmp, MANIFEST_PATH);
}

function updateTaskStatus(taskId, status, detail) {
  try {
    const m = readManifest();
    const task = m.tasks.find(t => t.id === taskId);
    if (!task) return;
    task.last_run = new Date().toISOString();
    task.last_status = status;
    if (detail) task.last_detail = detail;
    writeManifest(m);
  } catch (err) {
    console.error(`[scheduler] Failed to update manifest for ${taskId}:`, err.message);
  }
}

// --- Job runner ---------------------------------------------------------------

const runningJobs = new Map(); // taskId -> { proc, startedAt }

function runTask(task, { onStart, onEnd } = {}) {
  if (runningJobs.has(task.id)) {
    console.log(`[scheduler] ${task.id}: already running, skipping`);
    return null;
  }

  const scriptPath = join(SCRIPTS_DIR, task.script);
  if (!existsSync(scriptPath)) {
    console.error(`[scheduler] ${task.id}: script not found: ${scriptPath}`);
    return null;
  }

  const env = {
    ...process.env,
    HOME: process.env.HOME,
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:'
      + (process.env.HOME || '') + '/.local/bin',
  };

  const startedAt = new Date().toISOString();
  console.log(`[scheduler] ${task.id}: starting (${task.script})`);

  const proc = execFile('/bin/zsh', [scriptPath], {
    env,
    timeout: 720_000, // 12 min max
    cwd: SCRIPTS_DIR,
  }, (err) => {
    const ok = !err;
    const endedAt = new Date().toISOString();
    runningJobs.delete(task.id);

    updateTaskStatus(task.id, ok ? 'success' : 'error',
      ok ? null : (err.message || '').slice(0, 200));

    console.log(`[scheduler] ${task.id}: ${ok ? 'success' : 'error'} (${err?.message || 'ok'})`);

    if (onEnd) onEnd(task, { ok, startedAt, endedAt, error: err?.message });
  });

  proc.unref?.();
  runningJobs.set(task.id, { proc, startedAt });
  if (onStart) onStart(task, { startedAt, pid: proc.pid });

  return { pid: proc.pid, startedAt };
}

// --- Scheduler ----------------------------------------------------------------

const scheduledJobs = new Map(); // taskId -> cron.ScheduledTask

function startScheduler({ onStart, onEnd } = {}) {
  const manifest = readManifest();
  let started = 0;
  let skipped = 0;

  for (const task of manifest.tasks) {
    if (scheduledJobs.has(task.id)) {
      // Already scheduled (e.g. after a reload). Destroy old one first.
      scheduledJobs.get(task.id).stop();
      scheduledJobs.delete(task.id);
    }

    const cronExpr = parseScheduleToCron(task.schedule);
    if (!cronExpr) {
      console.warn(`[scheduler] ${task.id}: no cron expression, skipping`);
      skipped++;
      continue;
    }

    if (!cron.validate(cronExpr)) {
      console.error(`[scheduler] ${task.id}: invalid cron "${cronExpr}" from "${task.schedule}"`);
      skipped++;
      continue;
    }

    const job = cron.schedule(cronExpr, () => {
      // Re-read manifest at fire time to check if still enabled
      try {
        const live = readManifest();
        const liveTask = live.tasks.find(t => t.id === task.id);
        if (!liveTask || !liveTask.enabled) {
          console.log(`[scheduler] ${task.id}: disabled in manifest, skipping`);
          return;
        }
        runTask(liveTask, { onStart, onEnd });
      } catch (err) {
        console.error(`[scheduler] ${task.id}: manifest read error:`, err.message);
      }
    }, {
      scheduled: task.enabled,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    scheduledJobs.set(task.id, job);
    started++;
    console.log(`[scheduler] ${task.id}: ${cronExpr} (${task.enabled ? 'active' : 'paused'})`);
  }

  console.log(`[scheduler] Loaded ${started} jobs (${skipped} skipped)`);
  return { started, skipped };
}

function stopScheduler() {
  for (const [id, job] of scheduledJobs) {
    job.stop();
    console.log(`[scheduler] ${id}: stopped`);
  }
  scheduledJobs.clear();

  // Kill any running child processes
  for (const [id, { proc }] of runningJobs) {
    try { proc.kill('SIGTERM'); } catch { /* already gone */ }
    console.log(`[scheduler] ${id}: killed running process`);
  }
  runningJobs.clear();
}

// --- Public API for server.js -------------------------------------------------

function getStatus() {
  let manifest;
  try { manifest = readManifest(); } catch { manifest = { tasks: [] }; }

  return manifest.tasks.map(task => {
    const cronExpr = parseScheduleToCron(task.schedule);
    const isRunning = runningJobs.has(task.id);
    const running = isRunning ? runningJobs.get(task.id) : null;

    return {
      id: task.id,
      name: task.name,
      type: task.type,
      schedule: task.schedule,
      cron: cronExpr,
      enabled: task.enabled,
      running: isRunning,
      pid: running?.proc?.pid || null,
      startedAt: running?.startedAt || null,
      last_run: task.last_run || null,
      last_status: task.last_status || null,
      last_detail: task.last_detail || null,
    };
  });
}

function enableTask(taskId) {
  const m = readManifest();
  const task = m.tasks.find(t => t.id === taskId);
  if (!task) return { error: `Unknown task: ${taskId}` };
  task.enabled = true;
  writeManifest(m);

  const job = scheduledJobs.get(taskId);
  if (job) job.start();
  return { id: taskId, enabled: true };
}

function disableTask(taskId) {
  const m = readManifest();
  const task = m.tasks.find(t => t.id === taskId);
  if (!task) return { error: `Unknown task: ${taskId}` };
  task.enabled = false;
  writeManifest(m);

  const job = scheduledJobs.get(taskId);
  if (job) job.stop();
  return { id: taskId, enabled: false };
}

function triggerTask(taskId, { onStart, onEnd } = {}) {
  const m = readManifest();
  const task = m.tasks.find(t => t.id === taskId);
  if (!task) return { error: `Unknown task: ${taskId}` };
  if (runningJobs.has(taskId)) {
    const r = runningJobs.get(taskId);
    return { error: 'Already running', pid: r.proc.pid, startedAt: r.startedAt };
  }
  const result = runTask(task, { onStart, onEnd });
  if (!result) return { error: 'Failed to start task' };
  return { status: 'started', ...result };
}

export {
  startScheduler,
  stopScheduler,
  getStatus,
  enableTask,
  disableTask,
  triggerTask,
  parseScheduleToCron,
};
