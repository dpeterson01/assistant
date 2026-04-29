const API = '';
let briefing = null;
let healthData = null;
let automationHealth = null;
let showLowPriority = false;
let activeFilter = 'all';

// --- Job run handler ---
async function runJob(script) {
  const btn = document.querySelector(`button[data-script="${script}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳';
    btn.classList.add('opacity-50', 'cursor-wait');
  }
  try {
    const res = await fetch(`${API}/api/jobs/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (btn) { btn.textContent = '⚠️'; btn.title = data.error || 'Failed'; }
      return;
    }
    if (btn) { btn.textContent = '⏳ Running'; }
  } catch (e) {
    if (btn) { btn.textContent = '⚠️'; btn.title = e.message; }
  }
}

// ============================================================
// LOAD
// ============================================================

async function loadHealth() {
  try {
    const [hRes, aRes] = await Promise.all([
      fetch(`${API}/api/health`),
      fetch(`${API}/api/automation-health`),
    ]);
    if (hRes.ok) healthData = await hRes.json();
    if (aRes.ok) automationHealth = await aRes.json();
  } catch (e) { /* silent */ }
}

async function load() {
  await loadHealth();
  const res = await fetch(`${API}/api/briefing`);
  if (!res.ok) {
    document.getElementById('app').innerHTML = emptyState('No briefing found', 'Generate a briefing to see it here.');
    return;
  }
  briefing = await res.json();
  render();
}

async function manualRefresh() {
  const btn = document.getElementById('refresh-btn');
  const staleBanner = document.getElementById('stale-banner');
  const isStale = !staleBanner.classList.contains('hidden');

  if (isStale) {
    // Stale data: trigger full regeneration
    btn.classList.add('animate-spin');
    try {
      const res = await fetch(`${API}/api/regenerate`, { method: 'POST' });
      if (res.status === 409) {
        // Already regenerating, just show status
        showRegenBanner();
      } else if (res.ok) {
        showRegenBanner();
      } else {
        console.error('Regenerate failed:', await res.text());
        btn.classList.remove('animate-spin');
      }
    } catch (err) {
      console.error('Regenerate error:', err);
      btn.classList.remove('animate-spin');
    }
  } else {
    // Fresh data: just re-fetch JSON
    btn.classList.add('animate-spin');
    await load();
    setTimeout(() => btn.classList.remove('animate-spin'), 400);
  }
}

function showRegenBanner() {
  const banner = document.getElementById('stale-banner');
  const bannerInner = banner.querySelector('span:first-child');
  if (bannerInner) {
    bannerInner.innerHTML = '🔄 <span class="font-semibold">Regenerating briefing...</span> This takes a few minutes. The dashboard will update automatically when ready.';
  }
  banner.classList.remove('hidden', 'bg-amber-900/30', 'border-amber-600/20');
  banner.classList.add('bg-ios-blue/10', 'border-ios-blue/20');
  // Hide the refresh button in the banner
  const bannerBtn = banner.querySelector('button');
  if (bannerBtn) bannerBtn.classList.add('hidden');
  // Keep header refresh spinning
  document.getElementById('refresh-btn').classList.add('animate-spin');
}

function hideRegenBanner() {
  document.getElementById('refresh-btn').classList.remove('animate-spin');
  // Banner will be reset on next render()
}

function toggleStatus() {
  document.getElementById('status-drawer').classList.toggle('hidden');
}

// ============================================================
// HELPERS
// ============================================================

import {
  sourceMap, sourceLabel, sourceTint,
  priorityTint, priorityGlyph,
  categoryTint, categoryLabel,
  dayFitPalette,
  escapeHtml, escapeAttr,
  formatDate, shortDate, shortTime, shortDateTime,
  parseMeetingTime, formatMeetingTime,
  searchTermForItem,
} from './helpers.js';

function openWindow(url) { window.open(url, '_blank', 'noopener,width=1200,height=800'); }

// ============================================================
// CATEGORY FILTER
// ============================================================

function getCategories() {
  if (!briefing) return [];
  const cats = new Set();
  for (const section of ['carryOver', 'inbox', 'tasks']) {
    for (const item of briefing[section] || []) {
      if (item.category) cats.add(item.category);
    }
  }
  for (const item of briefing?.accountability?.waitingOn || []) {
    if (item.category) cats.add(item.category);
  }
  // Stable order: work, personal, church, hmbl, then any extras
  const order = ['work', 'personal', 'church', 'hmbl'];
  return [...order.filter(c => cats.has(c)), ...[...cats].filter(c => !order.includes(c)).sort()];
}

function setFilter(cat) {
  activeFilter = cat;
  render();
}

function filterByCategory(items) {
  if (activeFilter === 'all') return items;
  return items.filter(i => i.category === activeFilter);
}

function renderFilterBar() {
  const cats = getCategories();
  if (cats.length < 2) return '';
  const allActive = activeFilter === 'all';
  const allPill = `<button data-action="setFilter" data-args='["all"]' class="px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${allActive ? 'bg-white/15 text-zinc-100 border-white/20' : 'bg-transparent text-zinc-500 border-white/5 hover:text-zinc-300 hover:border-white/10'}">${allActive ? `All` : 'All'}</button>`;
  const catPills = cats.map(cat => {
    const isActive = activeFilter === cat;
    const count = [...(briefing.carryOver || []), ...(briefing.inbox || []), ...(briefing.tasks || [])].filter(i => i.category === cat && i.status !== 'done' && i.status !== 'dismissed').length;
    return `<button data-action="setFilter" data-args='${escapeAttr(JSON.stringify([cat]))}' class="px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${isActive ? categoryTint(cat) : 'bg-transparent text-zinc-500 border-white/5 hover:text-zinc-300 hover:border-white/10'}">
      ${escapeHtml(categoryLabel(cat))}${count ? ` <span class="tabular-nums opacity-60">${count}</span>` : ''}
    </button>`;
  }).join('');
  return `<div class="flex flex-wrap items-center gap-2 mb-5">${allPill}${catPills}</div>`;
}

function getSourceUrl(item) {
  if (!item) return null;
  const ch = item.channel, eid = item.emailId;
  if (item.teamsDeepLink) return item.teamsDeepLink;
  if (ch === 'teams' && item.threadId) return `https://teams.microsoft.com/l/message/${encodeURIComponent(item.threadId)}`;
  if (ch === 'outlook-work' && eid) return `https://outlook.office365.com/mail/deeplink/read/${encodeURIComponent(eid)}`;
  if (ch === 'outlook-personal' && eid) return `https://outlook.live.com/mail/deeplink/read/${encodeURIComponent(eid)}`;
  if (ch === 'gmail' && eid) return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(eid)}`;
  if (ch === 'hmbl' && eid) return `https://outlook.office365.com/mail/deeplink/read/${encodeURIComponent(eid)}`;

  // Fallback: no deep link but source is known — generate a search URL
  if (ch) {
    const q = encodeURIComponent(searchTermForItem(item));
    if (ch === 'teams') return `https://teams.microsoft.com/_#/search?q=${q}`;
    if (ch === 'gmail') return `https://mail.google.com/mail/u/0/#search/${q}`;
    if (ch === 'outlook-work' || ch === 'outlook-personal' || ch === 'hmbl' || ch === 'email') {
      return `https://outlook.office365.com/mail/0/search?q=${q}`;
    }
  }
  return null;
}

function nowMinutes() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

// ============================================================
// RENDER
// ============================================================

function render() {
  const d = briefing;
  document.getElementById('header-title').textContent = 'Mission Control';
  const today = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; })();
  const briefingDate = d.date || today;
  const isStale = briefingDate !== today;
  document.getElementById('header-date').textContent = formatDate(today);
  // Stale data banner
  const staleBanner = document.getElementById('stale-banner');
  window._briefingStale = isStale;
  if (isStale) {
    document.getElementById('stale-date').textContent = formatDate(briefingDate);
    staleBanner.classList.remove('hidden');
  } else {
    staleBanner.classList.add('hidden');
  }
  document.getElementById('header-dayfit').innerHTML = renderDayFitPill(d.dayFit);
  renderStatusButton();

  const allInbox = (d.inbox || []).filter(i => i.status === 'open');
  const draftableCount = allInbox.filter(i => (i.draftConfidence || 0) > 0).length;
  const openTasks = (d.tasks || []).filter(t => t.status !== 'done' && t.status !== 'dismissed');
  const meetings = isStale ? [] : (d.meetings || []);
  const acc = d.accountability || {};

  // --- Category filtering ---
  const filteredInbox = filterByCategory(allInbox);
  const filteredTasks = filterByCategory(openTasks);

  // --- Deduplication: remove items from tasks/carryOver that already appear in inbox ---
  const inboxTexts = new Set(allInbox.map(i => (i.text || '').toLowerCase().substring(0, 30)));
  const inboxIds = new Set(allInbox.map(i => i.id).filter(Boolean));
  function isInInbox(item) {
    if (item.id && inboxIds.has(item.id)) return true;
    const t = (item.text || '').toLowerCase().substring(0, 30);
    return t.length > 10 && inboxTexts.has(t);
  }
  const dedupedCarryOver = filterByCategory((d.carryOver || []).filter(i => !isInInbox(i) && i.status !== 'done' && i.status !== 'dismissed'));
  const dedupedTasks = filteredTasks.filter(i => !isInInbox(i));

  // --- Build urgency map from accountability data ---
  // Maps normalized text prefixes to urgency type for badge display
  const urgencyMap = new Map();
  (acc.overdue || []).forEach(s => {
    const text = typeof s === 'string' ? s : (s.text || '');
    urgencyMap.set(text.toLowerCase().substring(0, 30), 'overdue');
  });
  (acc.approaching || []).forEach(s => {
    const text = typeof s === 'string' ? s : (s.text || '');
    urgencyMap.set(text.toLowerCase().substring(0, 30), 'approaching');
  });

  // Attach urgency to carryOver/task items
  function withUrgency(items) {
    return items.map(item => {
      const t = (item.text || '').toLowerCase().substring(0, 30);
      // Check if any urgency key is contained in this item's text or vice versa
      for (const [key, type] of urgencyMap) {
        if (t.includes(key.substring(0, 15)) || key.includes(t.substring(0, 15))) {
          return { ...item, _urgency: type };
        }
      }
      return item;
    });
  }
  const focusCarryOver = withUrgency(dedupedCarryOver);
  const focusTasks = withUrgency(dedupedTasks);
  const focusCount = focusCarryOver.length + focusTasks.length;

  // Per-section render: catch and contain errors so one bad section can't
  // blank the entire dashboard. Logs to console with the section name so a
  // partial outage is debuggable.
  const safe = (name, fn) => {
    try { return fn(); }
    catch (e) {
      console.error(`render: ${name} threw`, e);
      return `<section class="rounded-2xl bg-ios-red/5 border border-ios-red/20 hairline p-4 text-[12px] text-ios-red">
        <div class="font-semibold mb-1">Couldn't render ${escapeHtml(name)}</div>
        <div class="text-ios-red/80 text-[11px]">${escapeHtml(e.message || String(e))}</div>
      </section>`;
    }
  };

  document.getElementById('app').innerHTML = `
    <!-- Day Fit hero (mobile only on small, full on all) -->
    ${safe('day fit', () => renderDayFitHero(d.dayFit))}

    <!-- Category filter -->
    ${safe('filter bar', () => renderFilterBar())}

    <!-- Stats grid -->
    <section class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      ${safe('stat: meetings', () => statCard('Meetings today', meetings.length, meetings.filter(m => m.highStakes).length ? `${meetings.filter(m => m.highStakes).length} high stakes` : 'all clear', 'ios-blue', iconCalendar()))}
      ${safe('stat: inbox', () => statCard('Inbox shown', filteredInbox.length, d.inboxLowCount ? `+${d.inboxLowCount} low hidden` : 'all shown', 'ios-orange', iconInbox()))}
      ${safe('stat: focus', () => statCard("Today's focus", focusCount, dedupedCarryOver.length ? `${dedupedCarryOver.length} carry over` : 'fresh start', 'ios-green', iconCheck()))}
      ${safe('stat: draftable', () => statCard('Draftable', filteredInbox.filter(i => (i.draftConfidence || 0) > 0).length, filteredInbox.filter(i => (i.draftConfidence || 0) > 0).length ? 'with confidence ≥40%' : 'nothing draftable', 'ios-indigo', iconPen()))}
    </section>

    <!-- Two-column layout on desktop -->
    <div class="grid lg:grid-cols-5 gap-6">
      <!-- LEFT (main column, spans 3) -->
      <div class="lg:col-span-3 space-y-6 min-w-0">
        ${safe('schedule', () => renderSchedule(meetings))}
        ${safe('inbox', () => renderInbox(filteredInbox, activeFilter === 'all' ? d.inboxLowCount : 0))}
        ${safe("today's focus", () => renderTodaysFocus(focusCarryOver, focusTasks))}
      </div>

      <!-- RIGHT rail -->
      <aside class="lg:col-span-2 space-y-6 min-w-0">
        ${safe('commitments', () => renderCommitments(acc))}
        ${safe('upcoming', () => renderUpcoming(d.upcoming || []))}
      </aside>
    </div>

    <footer class="mt-10 pt-6 border-t border-white/5 hairline text-[11px] text-zinc-600 flex flex-wrap items-center gap-x-4 gap-y-1">
      <span>Generated ${shortTime(d.generatedAt)}</span>
      <span>Updated ${shortTime(d.lastUpdated)}</span>
      <span>${d.updateCount || 0} updates today</span>
    </footer>
  `;

}

// ============================================================
// SECTIONS
// ============================================================

function statCard(label, value, sublabel, color, icon) {
  return `
  <div class="relative overflow-hidden rounded-2xl bg-zinc-900/60 border border-white/5 hairline px-4 py-3.5 animate-fade-in">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">${label}</div>
        <div class="mt-1 text-2xl font-semibold text-zinc-50 tabular-nums leading-none font-display">${value}</div>
        <div class="mt-1.5 text-[11px] text-zinc-500 truncate">${sublabel}</div>
      </div>
      <div class="shrink-0 w-8 h-8 rounded-lg bg-${color}/10 text-${color} flex items-center justify-center">${icon}</div>
    </div>
  </div>`;
}

function renderDayFitPill(df) {
  if (!df) return '';
  const p = dayFitPalette(df.level);
  return `<div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${p.bg} ${p.border} border hairline">
    <span class="w-1.5 h-1.5 rounded-full ${p.text.replace('text-', 'bg-')} animate-pulse-dot"></span>
    <span class="text-[12px] font-semibold ${p.text} tabular-nums">${df.score}/100</span>
  </div>`;
}

function renderDayFitHero(df) {
  if (!df) return '';
  const p = dayFitPalette(df.level);
  return `
  <section class="mb-6 rounded-2xl ${p.bg} ${p.border} border hairline shadow-2xl ${p.glow} p-5 animate-fade-in">
    <div class="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-5">
      <div class="flex items-baseline gap-2">
        <span class="text-5xl sm:text-6xl font-semibold tracking-tight tabular-nums ${p.text} font-display leading-none">${df.score}</span>
        <span class="text-zinc-500 text-lg">/ 100</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">Day Fit</div>
        <p class="mt-1 text-zinc-200 text-[15px] leading-snug">${escapeHtml(df.summary || '')}</p>
      </div>
    </div>
    ${(df.failures?.length || df.passes?.length) ? `
    <ul class="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
      ${(df.failures || []).map(f => `<li class="flex gap-2 text-zinc-300"><span class="text-ios-red shrink-0" aria-label="fail">✗</span><span>${escapeHtml(f)}</span></li>`).join('')}
      ${(df.passes || []).map(pass => `<li class="flex gap-2 text-zinc-400"><span class="text-ios-green shrink-0" aria-label="pass">✓</span><span>${escapeHtml(pass)}</span></li>`).join('')}
    </ul>` : ''}
    ${df.recoveryMoves?.length ? `<div class="mt-4 pt-4 border-t border-white/10 hairline text-[13px] text-zinc-300">
      <span class="text-ios-yellow font-semibold">Recovery → </span>${escapeHtml(df.recoveryMoves.join(' '))}
    </div>` : ''}
  </section>`;
}

function renderSchedule(meetings) {
  if (!meetings.length) {
    const msg = window._briefingStale
      ? emptyState('No briefing for today', 'Run /morning-briefing to generate today\'s schedule.')
      : emptyState('No meetings today', 'Enjoy the focus time.');
    return sectionShell('Today\'s schedule', `${meetings.length}`, msg);
  }

  const nowMin = nowMinutes();
  const items = meetings.map(m => {
    const start = parseMeetingTime(m.time);
    const end = parseMeetingTime(m.endTime);
    const isPast = end !== null && end < nowMin;
    const isNow = start !== null && end !== null && start <= nowMin && nowMin < end;
    return { m, start, end, isPast, isNow };
  });

  // Find the next-up meeting (first not-past, not-now)
  const nextUpIdx = items.findIndex(x => !x.isPast && !x.isNow);

  const list = items.map((x, idx) => {
    const m = x.m;
    const tags = [];
    if (m.highStakes) tags.push(`<span class="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-ios-yellow/15 text-ios-yellow uppercase tracking-wider">High stakes</span>`);
    if (m.optional) tags.push(`<span class="text-[11px] text-zinc-500">optional</span>`);
    if (m.tentative) tags.push(`<span class="text-[11px] text-zinc-500">tentative</span>`);
    if (m.attended) tags.push(`<span class="inline-flex items-center gap-1 text-[11px] text-ios-green">✓ attended</span>`);

    const dotColor = x.isNow ? 'bg-ios-green ring-4 ring-ios-green/20 animate-pulse-dot'
      : x.isPast ? 'bg-zinc-700'
        : idx === nextUpIdx ? 'bg-ios-blue ring-4 ring-ios-blue/15'
          : 'bg-zinc-600';

    const titleTone = x.isPast ? 'text-zinc-500' : 'text-zinc-100';
    const liveBadge = x.isNow ? `<span class="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-ios-green/15 text-ios-green uppercase tracking-wider"><span class="w-1 h-1 rounded-full bg-ios-green animate-pulse-dot"></span>Now</span>` : '';
    const nextBadge = (idx === nextUpIdx && !x.isNow) ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-ios-blue/15 text-ios-blue uppercase tracking-wider">Next</span>` : '';

    // Summary-level details: attendees, conflict, prep indicator
    const attendeeCount = m.attendees?.length || 0;
    const summaryMeta = [];
    if (attendeeCount) summaryMeta.push(`${attendeeCount} attendee${attendeeCount !== 1 ? 's' : ''}`);
    if (m.conflict) summaryMeta.push('⚠ conflict');
    if (m.prep) summaryMeta.push('📋 prep needed');
    if (m.raiseThis?.length) summaryMeta.push(`${m.raiseThis.length} talking pt${m.raiseThis.length !== 1 ? 's' : ''}`);
    if (m.peopleContext?.length) summaryMeta.push(`${m.peopleContext.length} people note${m.peopleContext.length !== 1 ? 's' : ''}`);
    const hasDetails = m.conflict || m.whyItMatters || attendeeCount || m.signals?.length || m.raiseThis?.length || m.peopleContext?.length || m.prep;

    // Right-justified stacked artifact pills (recap, transcript). Rendered
    // outside <summary> so clicking them doesn't toggle the disclosure.
    const pillParts = [];
    if (m.recapAvailable && m.id) {
      const href = `/api/meeting-artifact?event_id=${encodeURIComponent(m.id)}&kind=recap`;
      pillParts.push(`<a href="${escapeAttr(href)}" target="_blank" rel="noopener" title="Open recap" class="meeting-pill inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-ios-indigo/15 text-ios-indigo uppercase tracking-wider hover:bg-ios-indigo/25 transition-colors">Recap</a>`);
    }
    if (m.transcriptAvailable && m.recordingUrl) {
      pillParts.push(`<a href="${escapeAttr(m.recordingUrl)}" target="_blank" rel="noopener" title="Open transcript / recording" class="meeting-pill inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-ios-blue/15 text-ios-blue uppercase tracking-wider hover:bg-ios-blue/25 transition-colors">Transcript</a>`);
    }
    const pillStack = pillParts.length
      ? `<div class="absolute right-2 top-3 z-10 flex flex-col items-end gap-1">${pillParts.join('')}</div>`
      : '';

    return `
    <div class="relative">
    ${pillStack}
    <details${x.isNow ? ' open' : ''} class="group">
      <summary class="relative flex items-start gap-3 py-3 cursor-pointer hover:bg-white/[0.02] -mx-2 px-2 rounded-lg transition-colors">
        <div class="relative shrink-0 w-3 mt-1.5">
          <span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ${dotColor}"></span>
        </div>
        <div class="shrink-0 w-16 sm:w-20 text-right">
          <div class="text-[12px] font-semibold tabular-nums ${x.isPast ? 'text-zinc-600' : 'text-zinc-200'}">${formatMeetingTime(m.time)}</div>
          <div class="text-[10px] text-zinc-600 tabular-nums">${m.duration ? m.duration + 'm' : ''}</div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-1.5">
            ${hasDetails ? `<span class="chev text-zinc-600 text-xs transition-transform">▸</span>` : `<span class="w-3"></span>`}
            <span class="text-[14px] font-medium ${titleTone} truncate">${escapeHtml(m.title || 'Untitled')}</span>
            ${liveBadge} ${nextBadge}
          </div>
          ${tags.length ? `<div class="mt-1 ml-[1.125rem] flex flex-wrap items-center gap-1.5">${tags.join('')}</div>` : ''}
          ${summaryMeta.length ? `<div class="mt-0.5 ml-[1.125rem] text-[11px] text-zinc-600">${summaryMeta.join(' · ')}</div>` : ''}
        </div>
      </summary>
      ${hasDetails ? `<div class="ml-9 sm:ml-[7.5rem] pb-4 pt-1 text-[13px] text-zinc-300 space-y-2">
        ${m.conflict ? `<div class="text-ios-red font-medium flex items-center gap-1.5"><span aria-hidden="true">⚠</span>${escapeHtml(m.conflict)}</div>` : ''}
        ${m.whyItMatters ? `<p class="text-zinc-400">${escapeHtml(m.whyItMatters)}</p>` : ''}
        ${m.attendees?.length ? `<div class="text-[11px] text-zinc-500"><span class="text-zinc-600">Attendees · </span>${escapeHtml(m.attendees.join(', '))}</div>` : ''}
        ${m.signals?.length ? `<div><div class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Signals</div><ul class="space-y-1.5 text-zinc-300">${m.signals.map(s => {
          if (typeof s === 'object' && s.summary) {
            const src = s.source ? `<span class="text-[10px] font-medium text-zinc-500 uppercase">${escapeHtml(s.source)}</span>` : '';
            const who = s.who ? `<span class="text-zinc-400 font-medium">${escapeHtml(s.who)}</span>` : '';
            const meta = [src, who].filter(Boolean).join(' · ');
            return `<li class="flex flex-col gap-0.5"><div class="flex items-center gap-1.5">${meta ? `<span class="text-zinc-600">·</span><span class="text-[11px]">${meta}</span>` : ''}</div><span class="text-zinc-300 leading-snug">${escapeHtml(s.summary)}</span></li>`;
          }
          return `<li class="flex gap-2"><span class="text-zinc-600">·</span><span>${escapeHtml(String(s))}</span></li>`;
        }).join('')}</ul></div>` : ''}
        ${m.raiseThis?.length ? `<div><div class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Raise</div><ul class="space-y-1.5 text-zinc-300">${m.raiseThis.map(s => {
          if (typeof s === 'object' && s.detail) {
            return `<li class="flex flex-col gap-0.5"><div class="flex items-center gap-1.5"><span class="text-ios-yellow">→</span><span class="font-medium text-zinc-200">${escapeHtml(s.topic || 'Item')}</span></div><span class="text-zinc-400 text-[12px] leading-snug">${escapeHtml(s.detail)}</span></li>`;
          }
          return `<li class="flex gap-2"><span class="text-ios-yellow">→</span><span>${escapeHtml(String(s))}</span></li>`;
        }).join('')}</ul></div>` : ''}
        ${m.peopleContext?.length ? `<div><div class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">People</div><div class="space-y-2">${m.peopleContext.map(p => {
          const typeIcon = { birthday: '🎂', style: '🎯', history: '📅', relationship: '🔗', watch: '⚠️', personal: '👤' };
          const items = (p.items || []).map(i => {
            const icon = typeIcon[i.type] || '·';
            return `<div class="flex gap-2 text-[12px]"><span class="shrink-0" aria-hidden="true">${icon}</span><span class="text-zinc-400">${escapeHtml(i.detail || '')}</span></div>`;
          }).join('');
          return `<div><span class="text-zinc-300 text-[12px] font-medium">${escapeHtml(p.name || '')}</span>${items}</div>`;
        }).join('')}</div></div>` : ''}
        ${m.prep ? `<div class="rounded-lg bg-white/5 border border-white/5 hairline px-3 py-2"><span class="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Prep · </span><span class="text-zinc-200">${escapeHtml(m.prep)}</span></div>` : ''}
      </div>` : ''}
    </details>
    </div>`;
  }).join('');

  const inner = `<div class="relative">
    <div class="absolute left-[1.125rem] top-2 bottom-2 w-px bg-white/5"></div>
    <div class="divide-y divide-white/5">${list}</div>
  </div>`;

  return sectionShell("Today's schedule", `${meetings.length}`, inner, { padded: false });
}

function renderInbox(items, lowCount) {
  const high = items.filter(i => i.priority === 'high');
  const medium = items.filter(i => i.priority === 'medium');
  const low = items.filter(i => i.priority === 'low');
  const totalLow = low.length || lowCount || 0;

  if (!items.length && !totalLow) {
    return sectionShell('Inbox', '0', emptyState('Inbox zero', 'Nothing waiting.'));
  }

  // Sort top items by draftConfidence desc within priority bucket
  const byConf = arr => [...arr].sort((a, b) => (b.draftConfidence || 0) - (a.draftConfidence || 0));
  const top = [...byConf(high), ...byConf(medium)];
  const lowSorted = byConf(low);

  const topList = top.length
    ? `<div class="space-y-2">${top.map(i => renderItem(i, 'inbox')).join('')}</div>`
    : `<div class="text-center py-6 text-[13px] text-zinc-600">No high or medium priority items.</div>`;

  let lowBlock = '';
  if (totalLow > 0) {
    if (lowSorted.length) {
      // Server provided low items — render collapsible
      lowBlock = `
        <div class="mt-3">
          <button data-action="toggleLowPriority" class="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-white/5 hairline bg-white/[0.02] hover:bg-white/[0.05] text-[12px] text-zinc-400 hover:text-zinc-200 transition-colors">
            <span class="flex items-center gap-2">
              <svg class="w-3.5 h-3.5 chev" style="${showLowPriority ? 'transform:rotate(90deg)' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              <span class="font-medium">${showLowPriority ? 'Hide' : 'Show'} ${lowSorted.length} low-priority ${lowSorted.length === 1 ? 'item' : 'items'}</span>
            </span>
            <span class="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-ios-green/10 text-ios-green">low</span>
          </button>
          <div id="low-priority-list" class="${showLowPriority ? 'mt-2 space-y-2' : 'hidden'}">
            ${lowSorted.map(i => renderItem(i, 'inbox')).join('')}
          </div>
        </div>`;
    } else {
      // Legacy briefing — only a count, no items
      lowBlock = `
        <div class="mt-3 rounded-lg border border-dashed border-white/10 hairline px-3 py-2.5 text-center text-[12px] text-zinc-500">
          <span class="text-zinc-400">${totalLow}</span> low-priority items not in this briefing
          <span class="text-zinc-600 block mt-0.5">Regenerate the briefing to surface them inline</span>
        </div>`;
    }
  }

  const countLabel = `${top.length} open${totalLow ? ` · ${totalLow} low` : ''}`;
  return sectionShell('Inbox', countLabel, topList + lowBlock);
}

function toggleLowPriority() {
  showLowPriority = !showLowPriority;
  // Re-render only the inbox section by triggering a full render (cheap, preserves state)
  render();
}

function renderTodaysFocus(carryOver, openTasks) {
  const openCarry = carryOver.filter(i => i.status !== 'done' && i.status !== 'dismissed');
  const openNew = openTasks.filter(i => i.status !== 'done' && i.status !== 'dismissed');
  const all = [...openCarry, ...openNew];
  if (!all.length) {
    return sectionShell("Today's Focus", '0', emptyState('All clear', 'Nothing in focus today.'));
  }
  const inner = `
    ${openCarry.length ? `<div class="mb-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Carry over</div>` : ''}
    ${openCarry.length ? `<div class="space-y-2 mb-4">${openCarry.map(i => renderItem(i, 'carryOver')).join('')}</div>` : ''}
    ${openNew.length ? `<div class="mb-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">New</div>` : ''}
    ${openNew.length ? `<div class="space-y-2">${openNew.map(i => renderItem(i, 'tasks')).join('')}</div>` : ''}
  `;
  return sectionShell("Today's Focus", `${all.length}`, inner);
}

function renderCommitments(acc) {
  if (!acc) return '';
  const overdue = acc.overdue || [];
  const approaching = acc.approaching || [];
  const waitingList = Array.isArray(acc.waitingOn) ? acc.waitingOn : [];
  const filteredWaiting = activeFilter === 'all' ? waitingList : waitingList.filter(w => w.category === activeFilter);
  const waitingCount = activeFilter === 'all' ? (acc.waitingOnOthers || waitingList.length || 0) : filteredWaiting.length;
  const staleCount = activeFilter === 'all' ? (acc.stale || waitingList.filter(w => w.stale).length || 0) : filteredWaiting.filter(w => w.stale).length;

  // --- Helper: parse a legacy string item into a structured object ---
  function parseStringItem(s, urgencyType) {
    if (typeof s === 'object' && s !== null) return { ...s, _urgency: urgencyType };
    const personMatch = s.match(/\(([^)]+)\)/) || s.match(/^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*[—–-]/);
    const person = personMatch ? personMatch[1] : '';
    return { text: s, person, _urgency: urgencyType };
  }

  // --- Helper: build a source link for an accountability item ---
  // Cross-references carryOver/inbox items to find real deep links (emailId, teamsDeepLink)
  // instead of falling back to generic search URLs.
  function itemSourceLink(item) {
    if (item.sourceUrl) return { url: item.sourceUrl, label: 'Source' };

    // Task items (Things 3) have no external link
    const itemCh = (item.channel || '').toLowerCase();
    if (itemCh === 'task') return { url: null, label: 'Things 3' };

    // Try to find a matching carryOver or inbox item with deep link or source data
    const allItems = [...(briefing.carryOver || []), ...(briefing.inbox || [])];
    const person = (item.person || '').toLowerCase();
    const text = (item.text || item.item || '').toLowerCase();

    const match = allItems.find(ci => {
      if (!ci.emailId && !ci.teamsDeepLink && !ci.threadId && !ci.channel) return false;
      const ciText = (ci.text || '').toLowerCase();
      const ciSender = (ci.sender || '').toLowerCase();
      // Match by person name in sender, or by overlapping text
      if (person && ciSender && ciSender.includes(person.split(' ')[0].toLowerCase())) return true;
      if (person && ciText.includes(person.split(' ')[0].toLowerCase())) return true;
      // Match by significant text overlap
      if (text.length > 10 && ciText.includes(text.substring(0, 20))) return true;
      return false;
    });

    if (match) {
      const url = getSourceUrl(match);
      if (url) {
        const ch = match.channel || '';
        const label = sourceMap[ch] || 'Source';
        return { url, label };
      }
      // No deep link, but matched item has a source — use it for search fallback
      if (match.channel) {
        const mch = match.channel.toLowerCase();
        const searchTerm = encodeURIComponent(item.person || item.text || item.item || '');
        if (mch === 'teams') return { url: `https://teams.microsoft.com/_#/search?q=${searchTerm}`, label: 'Teams' };
        if (mch === 'gmail') return { url: `https://mail.google.com/mail/u/0/#search/${searchTerm}`, label: 'Gmail' };
        if (mch.startsWith('outlook') || mch === 'email') return { url: `https://outlook.office365.com/mail/0/search?q=${searchTerm}`, label: 'Outlook' };
      }
    }

    // Use item.channel (from atlas-db) to route to the correct source
    const ch = (item.channel || '').toLowerCase();
    const personEnc = encodeURIComponent(item.person || '');
    const searchTerm = personEnc || encodeURIComponent(item.text || item.item || '');
    if (ch === 'teams') {
      return { url: `https://teams.microsoft.com/_#/search?q=${searchTerm}`, label: 'Teams' };
    }
    if (ch === 'gmail') {
      return { url: `https://mail.google.com/mail/u/0/#search/${searchTerm}`, label: 'Gmail' };
    }
    if (ch === 'hmbl' || ch.startsWith('outlook') || ch === 'email') {
      return { url: `https://outlook.office365.com/mail/0/search?q=${searchTerm}`, label: 'Outlook' };
    }

    // Last resort: infer from text content
    const blob = (item.text || '') + ' ' + (item.detail || '');
    const lower = blob.toLowerCase();
    if (lower.includes('teams')) {
      return { url: `https://teams.microsoft.com/_#/search?q=${searchTerm}`, label: 'Teams' };
    }
    if (person) {
      return { url: `https://outlook.office365.com/mail/0/search?q=${personEnc}`, label: 'Outlook' };
    }
    return null;
  }

  // --- Render a commitment card (owe or waiting) ---
  // type: 'owe' | 'waiting'
  function accCard(item, idx, type) {
    const isWaiting = type === 'waiting';
    const urgency = item._urgency; // 'overdue' | 'approaching' | undefined
    const isOverdue = urgency === 'overdue';
    const isApproaching = urgency === 'approaching';
    const borderClass = isOverdue ? 'bg-ios-red/5 border-ios-red/15'
      : isApproaching ? 'bg-ios-yellow/5 border-ios-yellow/15'
        : item.stale ? 'bg-ios-red/5 border-ios-red/15'
          : 'bg-white/[0.03] border-white/5';

    const title = isWaiting ? escapeHtml(item.person) : escapeHtml(item.text || '');
    const titleColor = (isOverdue || item.stale) ? 'text-ios-red' : 'text-zinc-100';
    const subtitle = isWaiting ? escapeHtml(item.item) : '';
    const detail = item.detail ? escapeHtml(item.detail) : '';
    const daysLabel = item.daysOpen ? `${item.daysOpen}d open` : '';

    // Urgency badge (inline, not a separate section)
    const urgencyBadge = isOverdue
      ? '<span class="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-ios-red/15 text-ios-red ring-1 ring-ios-red/20">overdue</span>'
      : isApproaching
        ? '<span class="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-ios-yellow/15 text-ios-yellow ring-1 ring-ios-yellow/20">due soon</span>'
        : '';

    const src = itemSourceLink(item);
    const sourceBtn = src
      ? (src.url
        ? `<a href="${escapeAttr(src.url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-medium border border-white/10 hairline bg-white/[0.03] text-zinc-300 hover:bg-ios-blue/15 hover:border-ios-blue/30 hover:text-ios-blue transition-colors" title="Open in ${escapeAttr(src.label)}">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      <span>${escapeHtml(src.label)}</span>
    </a>`
        : `<span class="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ${sourceTint(item.channel || '')}">${escapeHtml(src.label)}</span>`)
      : '';

    // For 'owe' items, use original overdue/approaching type+index for server calls
    const serverType = (type === 'owe' && item._origType) ? item._origType : type;
    const serverIdx = (type === 'owe' && item._origIdx !== undefined) ? item._origIdx : idx;

    const draftBtn = isWaiting
      ? `<button data-action="nudgeOne" data-args='${escapeAttr(JSON.stringify([idx]))}' class="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-semibold border border-white/10 hairline bg-white/[0.03] text-zinc-200 hover:bg-ios-indigo/15 hover:border-ios-indigo/30 hover:text-ios-indigo transition-colors" title="Draft a nudge">
          <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          <span>Nudge</span>
        </button>`
      : `<button data-action="draftAccItem" data-args='${escapeAttr(JSON.stringify([serverType, serverIdx]))}' class="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-semibold border border-white/10 hairline bg-white/[0.03] text-zinc-200 hover:bg-ios-indigo/15 hover:border-ios-indigo/30 hover:text-ios-indigo transition-colors" title="Draft a response">
          <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          <span>Draft</span>
        </button>`;

    const completeAction = isWaiting
      ? `data-action="dismissWaiting" data-args='${escapeAttr(JSON.stringify([idx]))}'`
      : `data-action="completeAccItem" data-args='${escapeAttr(JSON.stringify([serverType, serverIdx]))}'`;
    const completeBtn = `<button ${completeAction} class="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-medium border border-white/10 hairline bg-white/[0.03] text-zinc-300 hover:bg-ios-green/15 hover:border-ios-green/30 hover:text-ios-green transition-colors" title="Mark complete">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
      <span>Done</span>
    </button>`;

    const dismissAction = isWaiting
      ? `data-action="dismissWaiting" data-args='${escapeAttr(JSON.stringify([idx]))}'`
      : `data-action="dismissAccItem" data-args='${escapeAttr(JSON.stringify([serverType, serverIdx]))}'`;
    const dismissBtn = `<button ${dismissAction} class="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-medium border border-white/5 hairline bg-transparent text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300 transition-colors" title="Dismiss">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      <span>Dismiss</span>
    </button>`;

    const resultId = isWaiting ? `nudge-result-${idx}` : `acc-result-${serverType}-${serverIdx}`;

    return `
    <div class="rounded-lg ${borderClass} border hairline px-3 py-2 text-[13px]" data-acc-type="${serverType}" data-acc-idx="${serverIdx}">
      <div class="flex items-center gap-2">
        <span class="font-medium ${titleColor} truncate">${title}</span>
        ${urgencyBadge}
        ${item.stale ? '<span class="text-[10px] font-semibold uppercase tracking-wider text-ios-red shrink-0">stale</span>' : ''}
        ${daysLabel ? `<span class="text-[11px] text-zinc-600 tabular-nums shrink-0 ml-auto">${daysLabel}</span>` : ''}
      </div>
      ${subtitle ? `<div class="text-zinc-300 mt-0.5">${subtitle}</div>` : ''}
      ${detail ? `<div class="text-[11px] text-zinc-500 mt-0.5">${detail}</div>` : ''}
      <div class="mt-2 flex items-center gap-2">
        ${sourceBtn}
        ${draftBtn}
        ${completeBtn}
        ${dismissBtn}
      </div>
      <div id="${resultId}" class="hidden mt-2 rounded-lg border border-ios-indigo/20 bg-ios-indigo/[0.04] hairline p-3 text-[12px] text-zinc-200 whitespace-pre-wrap"></div>
    </div>`;
  }

  // Sort waiting list: stale first, then by daysOpen desc
  const waitingIdxMap = new Map(waitingList.map((w, i) => [w, i]));
  const waitingSorted = filteredWaiting
    .map(w => ({ ...w, _idx: waitingIdxMap.get(w) ?? 0 }))
    .sort((a, b) => {
      if (a.stale !== b.stale) return a.stale ? -1 : 1;
      return (b.daysOpen || 0) - (a.daysOpen || 0);
    });

  // Merge overdue + approaching into a single "I Owe" list, sorted: overdue first, then approaching
  // These are unstructured strings without category data — always show them regardless of filter
  const iOweItems = [
    ...overdue.map((s, i) => ({ ...parseStringItem(s, 'overdue'), _origType: 'overdue', _origIdx: i })),
    ...approaching.map((s, i) => ({ ...parseStringItem(s, 'approaching'), _origType: 'approaching', _origIdx: i }))
  ];

  // De-duplicate: remove I-Owe items that already appear in Today's Focus (carryOver)
  const carryTexts = new Set((briefing.carryOver || [])
    .filter(c => c.status !== 'done' && c.status !== 'dismissed')
    .map(c => (c.text || '').toLowerCase().trim()));
  const filteredIOwe = iOweItems.filter(item => {
    // Extract the core text before the em-dash detail suffix
    const raw = (item.text || '');
    const core = raw.includes('—') ? raw.split('—')[0].trim() : raw.trim();
    return !carryTexts.has(core.toLowerCase());
  });

  const iOweBlock = filteredIOwe.length
    ? `<div class="space-y-1.5">${filteredIOwe.map((item, idx) => accCard(item, idx, 'owe')).join('')}</div>`
    : `<div class="text-[12px] text-zinc-600 italic">All clear. No outstanding commitments.</div>`;

  const waitingBlock = waitingSorted.length
    ? `<div class="space-y-1.5">${waitingSorted.map(w => accCard(w, w._idx, 'waiting')).join('')}</div>`
    : `<div class="rounded-lg bg-white/[0.03] border border-white/5 hairline px-3 py-2.5 text-[13px] text-zinc-300 flex items-baseline gap-3">
        <span class="text-2xl font-semibold tabular-nums text-zinc-100 font-display leading-none">${waitingCount}</span>
        <span class="text-[12px] text-zinc-500">open follow-ups${staleCount ? ` · <span class="text-ios-red">${staleCount} stale</span>` : ''}</span>
      </div>
      <div class="mt-2 text-[11px] text-zinc-600">Tracked in <span class="font-mono text-zinc-500">assistant.db</span></div>`;

  const inner = `
    <div class="mb-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
      <span>I owe</span>
      <span class="tabular-nums text-zinc-600">${filteredIOwe.length}</span>
      ${filteredIOwe.filter(i => i._urgency === 'overdue').length ? `<span class="ml-auto text-[10px] font-semibold text-ios-red">${filteredIOwe.filter(i => i._urgency === 'overdue').length} overdue</span>` : ''}
    </div>
    <div class="space-y-1.5 mb-5">
      ${iOweBlock}
    </div>

    <div class="mb-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
      <span>Waiting on others</span>
      <span class="tabular-nums text-zinc-600">${waitingCount}</span>
      ${staleCount ? `<span class="ml-auto text-[10px] font-semibold text-ios-red">${staleCount} stale</span>` : ''}
    </div>
    ${waitingBlock}
  `;
  return sectionShell('Commitments', `${filteredIOwe.length + waitingCount}`, inner);
}

function renderUpcoming(upcoming) {
  if (!upcoming.length) {
    return sectionShell('Upcoming', '0', emptyState('Clear horizon', 'Nothing scheduled.'));
  }
  // Each entry can be either { date, items: [string, ...] } (new shape) or
  // { date, text: string } (briefing JSON shape). Normalize to items[].
  const normalized = upcoming.map(u => ({
    date: u.date,
    items: Array.isArray(u.items) ? u.items : (u.text ? [u.text] : []),
  }));
  const totalItems = normalized.reduce((n, u) => n + u.items.length, 0);
  const inner = `<div class="space-y-4">${normalized.map(u => `
    <div>
      <div class="mb-1.5 text-[11px] font-semibold text-ios-blue uppercase tracking-wider tabular-nums">${escapeHtml(shortDate(u.date) || u.date)}</div>
      <ul class="space-y-1">
        ${u.items.map(it => `
          <li class="flex gap-2 items-baseline text-[13px] text-zinc-200">
            <span class="text-zinc-600">·</span><span>${escapeHtml(it)}</span>
          </li>`).join('')}
      </ul>
    </div>`).join('')}</div>`;
  return sectionShell('Upcoming', `${totalItems}`, inner);
}

// ============================================================
// ITEM CARD (used by inbox + tasks)
// ============================================================

function renderItem(item, section) {
  const isDone = item.status === 'done';
  if (item.status === 'dismissed') return '';
  if (isDone) return '';

  const conf = item.draftConfidence || 0;
  const canDraft = section === 'inbox';
  const confColor = conf >= 0.85 ? 'text-ios-green'
    : conf >= 0.70 ? 'text-ios-blue'
      : conf >= 0.50 ? 'text-ios-yellow'
        : 'text-ios-orange';
  const confLabel = conf >= 0.85 ? 'high'
    : conf >= 0.70 ? 'good'
      : conf >= 0.50 ? 'fair'
        : 'low';
  const draftBtn = canDraft
    ? `<button data-action="draftOne" data-args='${escapeAttr(JSON.stringify([item.id]))}' class="shrink-0 inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-semibold border border-white/10 hairline bg-white/[0.03] text-zinc-200 hover:bg-ios-indigo/15 hover:border-ios-indigo/30 hover:text-ios-indigo transition-colors" title="${conf > 0 ? escapeAttr(confLabel + ' confidence — ' + Math.round(conf * 100) + '%') : 'Generate draft reply'}">
         <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
         <span>Draft</span>
         ${conf > 0 ? `<span class="${confColor} tabular-nums">${Math.round(conf * 100)}%</span>` : ''}
       </button>` : '';

  const priorityBadge = item.priority ? `<span class="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ring-1 ${priorityTint(item.priority)}" title="Priority: ${escapeHtml(item.priority)}"><span aria-hidden="true" class="mr-0.5">${priorityGlyph(item.priority)}</span>${escapeHtml(item.priority)}</span>` : '';
  const catBadge = item.category && activeFilter === 'all' ? `<span class="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${categoryTint(item.category)}">${escapeHtml(categoryLabel(item.category))}</span>` : '';
  const urgencyBadge = item._urgency === 'overdue'
    ? '<span class="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-ios-red/15 text-ios-red ring-1 ring-ios-red/20">overdue</span>'
    : item._urgency === 'approaching'
      ? '<span class="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-ios-yellow/15 text-ios-yellow ring-1 ring-ios-yellow/20">due soon</span>'
      : '';
  const sender = item.sender ? `<span class="text-[11px] text-zinc-500">${escapeHtml(item.sender)}</span>` : '';
  const receivedAt = (item.receivedAt || item.addedAt) && section === 'inbox'
    ? `<span class="text-[11px] text-zinc-600">·</span><span class="text-[11px] text-zinc-500 tabular-nums">${shortDateTime(item.receivedAt || item.addedAt)}</span>` : '';
  const sourceChip = item.channel
    ? `<span class="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ${sourceTint(item.channel)}">${escapeHtml(sourceLabel(item.channel))}</span>` : '';
  const chatName = item.channel === 'teams' && item.chatName
    ? `<span class="text-[11px] text-zinc-500">${escapeHtml(item.chatName)}</span>` : '';
  const sourceUrl = getSourceUrl(item);
  const sourceLink = sourceUrl
    ? `<a href="${escapeAttr(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-medium border border-white/10 hairline bg-white/[0.03] text-zinc-300 hover:bg-ios-blue/15 hover:border-ios-blue/30 hover:text-ios-blue transition-colors cursor-pointer" title="Open in ${escapeHtml(sourceLabel(item.channel))}">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      <span>${escapeHtml(sourceLabel(item.channel))}</span>
    </a>` : sourceChip;

  const dismissBtn = `<button data-action="dismissItem" data-args='${escapeAttr(JSON.stringify([item.id]))}' class="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-medium border border-white/5 hairline bg-transparent text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300 transition-colors" title="Dismiss">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      <span>Dismiss</span>
    </button>`;

  const doneBtn = `<button data-action="toggleItem" data-args='${escapeAttr(JSON.stringify([item.id]))}' class="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-medium border border-white/10 hairline bg-white/[0.03] text-zinc-300 hover:bg-ios-green/15 hover:border-ios-green/30 hover:text-ios-green transition-colors" title="Mark complete">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      <span>Done</span>
    </button>`;

  const isInbox = section === 'inbox';
  const showCheckbox = !isInbox;

  return `
  <div class="group rounded-xl bg-zinc-900/50 border border-white/5 hairline p-3 card-fade hover:bg-zinc-900/70 hover:border-white/10 transition-colors ${isDone ? 'opacity-50' : ''}" data-id="${item.id}" data-section="${section}">
    <div class="flex items-start gap-3">
      ${showCheckbox ? `<button data-action="toggleItem" data-args='${escapeAttr(JSON.stringify([item.id]))}' class="shrink-0 w-[22px] h-[22px] rounded-md border-2 ${isDone ? 'bg-ios-green border-ios-green text-white' : 'border-zinc-600 text-transparent hover:border-ios-green hover:text-ios-green'} flex items-center justify-center text-[12px] leading-none transition-colors" aria-label="Complete"><span aria-hidden="true">✓</span></button>` : ''}
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-[14px] text-zinc-100 ${isDone ? 'line-through text-zinc-500' : ''}">${escapeHtml(item.text || '')}</span>
          ${priorityBadge}
          ${catBadge}
          ${urgencyBadge}
        </div>
        ${item.detail ? `<div class="mt-1 text-[12px] text-zinc-400 leading-snug">${escapeHtml(item.detail)}</div>` : ''}
        <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          ${chatName} ${sender} ${receivedAt}
        </div>
        <div class="mt-2 flex items-center gap-2">
          ${sourceLink}
          ${draftBtn}
          ${isInbox ? doneBtn : ''}
          ${dismissBtn}
        </div>
      </div>
    </div>
  </div>`;
}

// ============================================================
// SECTION SHELL
// ============================================================

function sectionShell(title, count, body, opts = {}) {
  const padded = opts.padded !== false;
  if (opts.collapsible) {
    const openAttr = opts.defaultOpen ? ' open' : '';
    return `
    <section class="rounded-2xl bg-zinc-900/40 border border-white/5 hairline overflow-hidden animate-fade-in">
      <details${openAttr} class="group/sec">
        <summary class="flex items-center justify-between px-4 sm:px-5 py-3 cursor-pointer select-none">
          <div class="flex items-center gap-2">
            <span class="text-zinc-600 text-[10px] transition-transform group-open/sec:rotate-90">▸</span>
            <h2 class="text-[13px] font-semibold text-zinc-200 tracking-tight">${title}</h2>
            <span class="text-[11px] text-zinc-600 tabular-nums">${count}</span>
          </div>
        </summary>
        <div class="border-t border-white/5 hairline ${padded ? 'p-4 sm:p-5' : 'p-2 sm:p-3'}">${body}</div>
      </details>
    </section>`;
  }
  return `
  <section class="rounded-2xl bg-zinc-900/40 border border-white/5 hairline overflow-hidden animate-fade-in">
    <header class="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-white/5 hairline">
      <div class="flex items-center gap-2">
        <h2 class="text-[13px] font-semibold text-zinc-200 tracking-tight">${title}</h2>
        <span class="text-[11px] text-zinc-600 tabular-nums">${count}</span>
      </div>
    </header>
    <div class="${padded ? 'p-4 sm:p-5' : 'p-2 sm:p-3'}">${body}</div>
  </section>`;
}

function emptyState(title, sub) {
  return `<div class="text-center py-10">
    <div class="text-[13px] text-zinc-300 font-medium">${escapeHtml(title)}</div>
    <div class="mt-1 text-[12px] text-zinc-600">${escapeHtml(sub || '')}</div>
  </div>`;
}

// ============================================================
// STATUS PANEL
// ============================================================

function renderStatusButton() {
  const dot = document.getElementById('status-dot');
  const content = document.getElementById('status-content');

  const hasEndpoints = healthData?.endpoints && Object.keys(healthData.endpoints).length;
  const hasJobs = automationHealth?.jobs?.length;

  if (!hasEndpoints && !hasJobs) {
    dot.className = 'w-2 h-2 rounded-full bg-zinc-600';
    content.innerHTML = '<div class="text-zinc-500">Health data loading...</div>';
    return;
  }

  // Overall dot: green if healthy, yellow if warnings only, red if errors
  const apiOk = !hasEndpoints || healthData.allOk;
  const hasErrors = hasJobs && automationHealth.jobs.some(j => jobDotColor(j) === 'bg-ios-red');
  const hasWarnings = hasJobs && automationHealth.jobs.some(j => jobDotColor(j) === 'bg-ios-yellow');
  const overallColor = (!apiOk || hasErrors) ? 'bg-ios-red' : hasWarnings ? 'bg-ios-yellow' : 'bg-ios-green';
  dot.className = 'w-2 h-2 rounded-full ' + overallColor;

  let html = '';

  // --- Automation Jobs section ---
  if (hasJobs) {
    html += `<div class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">Scheduled Jobs</div>`;
    html += `<div class="space-y-0 text-[12px] mb-1">`;
    for (const job of automationHealth.jobs) {
      const statusMap = {
        ok:          { label: 'OK' },
        ran:         { label: 'RAN' },
        error:       { label: 'ERR' },
        'pat-expired': { label: 'PAT' },
        'no-log':    { label: '---' },
      };
      const s = statusMap[job.today] || statusMap['no-log'];
      const dotColor = jobDotColor(job);
      const lastOk = formatLastSuccess(job.last_success);
      const statusColor = dotColor === 'bg-ios-red' ? 'text-ios-red' : dotColor === 'bg-ios-yellow' ? 'text-ios-yellow' : dotColor === 'bg-ios-green' ? 'text-ios-green' : 'text-zinc-500';
      const runBtn = job.script
        ? `<button onclick="runJob('${escapeHtml(job.script)}')" class="job-run-btn px-1.5 py-0.5 text-[10px] font-medium rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white transition-colors" data-script="${escapeHtml(job.script)}">▶ Run</button>`
        : '';
      html += `<div class="flex items-center gap-3 py-1.5 border-t border-white/5">
        <span class="w-1.5 h-1.5 rounded-full ${dotColor} shrink-0"></span>
        <span class="text-zinc-300 flex-1 truncate">${escapeHtml(job.name)}</span>
        <span class="text-[11px] text-zinc-500 whitespace-nowrap">${escapeHtml(job.schedule)}</span>
        <span class="text-[11px] text-zinc-400 tabular-nums whitespace-nowrap w-16 text-right">${lastOk}</span>
        <span class="text-[10px] font-medium ${statusColor} w-7 text-right">${s.label}</span>
        <span class="w-12 text-center">${runBtn}</span>
      </div>`;
    }
    html += `</div>`;
    const okCount = automationHealth.jobs.filter(j => jobDotColor(j) === 'bg-ios-green').length;
    const warnCount = automationHealth.jobs.filter(j => jobDotColor(j) === 'bg-ios-yellow').length;
    const errCount = automationHealth.jobs.filter(j => jobDotColor(j) === 'bg-ios-red').length;
    const pending = automationHealth.jobs.filter(j => jobDotColor(j) === 'bg-zinc-600').length;
    html += `<div class="text-[11px] text-zinc-500 mt-1 mb-3">${okCount} healthy`;
    if (warnCount) html += ` &middot; <span class="text-ios-yellow">${warnCount} warning${warnCount > 1 ? 's' : ''}</span>`;
    if (errCount) html += ` &middot; <span class="text-ios-red">${errCount} error${errCount > 1 ? 's' : ''}</span>`;
    if (pending) html += ` &middot; ${pending} pending`;
    html += `</div>`;
  }

  // --- API Endpoints section ---
  if (hasEndpoints) {
    html += `<div class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">API Endpoints</div>`;
    const rows = Object.entries(healthData.endpoints).map(([name, ep]) => {
      const dotCls = ep.ok ? 'bg-ios-green' : 'bg-ios-red';
      const time = ep.at ? new Date(ep.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
      const detail = ep.detail ? `<span class="text-[11px] text-ios-red ml-1">${escapeHtml(ep.detail)}</span>` : '';
      return `<div class="flex items-center gap-2 py-1.5 border-b border-white/5 hairline last:border-0">
        <span class="w-1.5 h-1.5 rounded-full ${dotCls}"></span>
        <span class="flex-1 text-zinc-300">${escapeHtml(name)}</span>
        ${detail}
        <span class="text-[11px] text-zinc-500 tabular-nums">${time}</span>
      </div>`;
    }).join('');
    html += rows;
  }

  content.innerHTML = html;
}

// Dot = did the last *planned* run complete successfully?
// Green: ok or ran (completed, even with transient errors). Also green for
// no-log jobs whose last_success is within the expected cadence window.
// Red: error (last run failed). Yellow: never for dots (reserved for labels).
function jobDotColor(job) {
  if (job.today === 'ok' || job.today === 'ran') return 'bg-ios-green';
  if (job.today === 'error') return 'bg-ios-red';
  if (job.today === 'pat-expired') return 'bg-ios-yellow';
  // no-log: job hasn't run today. Check if last_success is within cadence.
  if (!job.last_success || job.last_success === 'never') return 'bg-zinc-600';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last = new Date(job.last_success + 'T00:00:00');
  const ageDays = Math.round((today - last) / 86400000);
  // Max acceptable age based on frequency
  const freq = (job.frequency || '').toLowerCase();
  let maxAge = 1;
  if (freq === 'weekly') maxAge = 7;
  else if (freq === 'weekdays') maxAge = today.getDay() === 0 ? 2 : today.getDay() === 1 ? 3 : 1;
  else if (freq === 'persistent') maxAge = 1;
  else maxAge = 1; // daily, Nx/day
  return ageDays <= maxAge ? 'bg-ios-green' : 'bg-ios-red';
}

function formatLastSuccess(dateStr) {
  if (!dateStr || dateStr === 'never' || dateStr.startsWith('none')) return dateStr || 'never';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((today - target) / 86400000);
    if (diff === 0) return 'today';
    if (diff === 1) return 'yesterday';
    return `${diff}d ago`;
  } catch { return dateStr; }
}

// ============================================================
// ACTIONS
// ============================================================

function toggleItem(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) {
    card.classList.add('opacity-50');
    const checkBtn = card.querySelector('button[aria-label="Complete"]');
    if (checkBtn) {
      checkBtn.classList.remove('border-zinc-600', 'text-transparent');
      checkBtn.classList.add('bg-ios-green', 'border-ios-green', 'text-white');
    }
    setTimeout(() => { card.style.opacity = '0'; setTimeout(() => { card.style.display = 'none'; }, 400); }, 2500);
  }
  for (const section of ['carryOver', 'inbox', 'tasks']) {
    const list = briefing[section];
    if (!list) continue;
    const item = list.find(i => i.id === id);
    if (item) { item.status = 'done'; break; }
  }
  actionInFlight++;
  fetch(`${API}/api/complete-task/${encodeURIComponent(id)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'ui' })
  }).then(() => { syncAfterActions(); showUndoToast(id, 'Completed'); }).catch(e => { console.error('complete failed', e); syncAfterActions(); });
}

function dismissItem(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) { card.style.opacity = '0'; setTimeout(() => { card.style.display = 'none'; }, 400); }
  for (const section of ['carryOver', 'inbox', 'tasks']) {
    const list = briefing[section];
    if (!list) continue;
    const item = list.find(i => i.id === id);
    if (item) { item.status = 'dismissed'; break; }
  }
  actionInFlight++;
  fetch(`${API}/api/dismiss/${encodeURIComponent(id)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'ui' })
  }).then(() => { syncAfterActions(); showUndoToast(id, 'Dismissed'); }).catch(e => { console.error('dismiss failed', e); syncAfterActions(); });
}

// --- Undo toast ---
const UNDO_GRACE_MS = 15000;

function showUndoToast(id, label) {
  const container = document.getElementById('undo-container');
  const toast = document.createElement('div');
  toast.className = 'undo-toast pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-xl bg-zinc-800/90 border border-white/10 shadow-lg backdrop-blur-sm text-sm text-zinc-200';
  toast.dataset.undoId = id;
  toast.innerHTML = `
    <span class="flex-1">${label}</span>
    <button data-action="undoItem" data-args='${escapeAttr(JSON.stringify([id]))}' class="text-ios-blue font-medium hover:text-ios-blue/80 transition-colors text-sm">Undo</button>
    <div class="absolute bottom-0 left-0 h-0.5 bg-ios-blue/40 rounded-full undo-timer" style="animation-duration:${UNDO_GRACE_MS}ms"></div>
  `;
  toast.style.position = 'relative';
  toast.style.overflow = 'hidden';
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, UNDO_GRACE_MS);
}

async function undoItem(id, toastEl) {
  // Resolve the toast either from explicit arg (legacy) or by id (delegation path).
  if (!toastEl) toastEl = document.querySelector(`.undo-toast[data-undo-id="${CSS.escape(String(id))}"]`);
  if (toastEl) toastEl.remove();
  try {
    const res = await fetch(`${API}/api/undo/${encodeURIComponent(id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    });
    const result = await res.json();
    if (res.ok) {
      // Restore local state and re-render
      for (const section of ['carryOver', 'inbox', 'tasks']) {
        const list = briefing[section];
        if (!list) continue;
        const item = list.find(i => i.id === id);
        if (item) { item.status = result.restoredStatus || 'open'; break; }
      }
      render();
    } else {
      console.warn('Undo failed:', result.error);
    }
  } catch (e) { console.error('Undo error:', e); }
}

async function draftOne(id) {
  openDraftModal(id);
}

// ============================================================
// DRAFT MODAL
// ============================================================

let _modalItemId = null;
let _modalItem = null;
let _modalReturnFocus = null;

function openDraftModal(itemId) {
  _modalItemId = itemId;

  // Find the item in briefing data
  _modalItem = null;
  for (const section of ['inbox', 'carryOver', 'tasks']) {
    const found = (briefing[section] || []).find(i => i.id === itemId);
    if (found) { _modalItem = found; break; }
  }

  // Populate header
  const subjectEl = document.getElementById('dm-subject');
  const senderEl = document.getElementById('dm-sender');
  const timeEl = document.getElementById('dm-time');
  const badge = document.getElementById('dm-source-badge');
  subjectEl.textContent = _modalItem?.text || 'Message';
  senderEl.textContent = _modalItem?.sender || '';
  const ts = _modalItem?.receivedAt || _modalItem?.addedAt;
  timeEl.textContent = ts ? shortDateTime(ts) : '';

  const ch = _modalItem?.channel || 'email';
  badge.textContent = sourceLabel(ch);
  badge.className = `text-[10px] font-medium px-1.5 py-0.5 rounded ${sourceTint(ch)}`;

  // Reset content areas
  const origEl = document.getElementById('dm-original');
  origEl.innerHTML = '<span class="spinner"></span> Loading message...';

  const loadingEl = document.getElementById('dm-draft-loading');
  const textareaEl = document.getElementById('dm-draft-textarea');
  loadingEl.classList.remove('hidden');
  loadingEl.innerHTML = '<span class="spinner"></span> Generating draft...';
  textareaEl.classList.add('hidden');
  textareaEl.value = '';
  delete textareaEl.dataset.userEdited;

  // Reset action buttons
  document.getElementById('dm-btn-save').disabled = true;
  document.getElementById('dm-btn-copy').disabled = true;
  document.getElementById('dm-btn-regen').disabled = true;
  document.getElementById('dm-status').textContent = '';

  // Update save button label based on source
  const saveBtn = document.getElementById('dm-btn-save');
  const saveLabelMap = {
    'outlook-work': 'Save Draft & Open Outlook',
    'outlook-personal': 'Save Draft & Open Outlook',
    email: 'Save Draft & Open Outlook',
    gmail: 'Save Draft & Open Gmail',
    hmbl: 'Save Draft & Open HMBL',
    teams: 'Copy to Clipboard',
  };
  saveBtn.innerHTML = `
    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
    ${saveLabelMap[ch] || 'Save Draft'}`;

  // Show modal
  document.getElementById('draft-modal-overlay').classList.remove('hidden');
  document.getElementById('draft-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Focus management: remember the trigger so we can restore focus on close,
  // then move focus into the modal so screen-reader and keyboard users land
  // inside the dialog.
  _modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  setTimeout(() => {
    const ta = document.getElementById('dm-draft-textarea');
    if (ta && !ta.classList.contains('hidden')) { ta.focus(); return; }
    const closeBtn = document.querySelector('#draft-modal [aria-label="Close draft modal"]');
    if (closeBtn) closeBtn.focus();
  }, 0);

  // Fire both requests in parallel
  fetchOriginalMessage(itemId);
  fetchDraftReply(itemId);
}

// Tab/Shift-Tab cycle within the modal so focus can't escape into the page
// behind it. No-op when the modal is closed.
function _trapModalFocus(e) {
  if (!_modalItemId || e.key !== 'Tab') return;
  const modal = document.getElementById('draft-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  const focusables = modal.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function closeDraftModal() {
  document.getElementById('draft-modal-overlay').classList.add('hidden');
  document.getElementById('draft-modal').classList.add('hidden');
  document.body.style.overflow = '';
  _modalItemId = null;
  _modalItem = null;
  // Return focus to whatever opened the modal so keyboard navigation resumes
  // where the user left off.
  if (_modalReturnFocus && document.contains(_modalReturnFocus)) {
    try { _modalReturnFocus.focus(); } catch { /* ignore */ }
  }
  _modalReturnFocus = null;
}

// Keyboard: Esc to close, Tab cycles within modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _modalItemId) { closeDraftModal(); return; }
  _trapModalFocus(e);
});

async function fetchOriginalMessage(itemId) {
  const origEl = document.getElementById('dm-original');
  try {
    const res = await fetch(`${API}/api/message/${encodeURIComponent(itemId)}`);
    const data = await res.json();
    if (data.ok && data.body) {
      origEl.textContent = data.body;
    } else {
      // Fallback: show the detail from the briefing item
      const fallback = _modalItem?.detail || 'Could not load original message.';
      origEl.innerHTML = `<div class="text-zinc-500 italic text-[12px] mb-2">Original message not available. Showing briefing summary:</div><div>${escapeHtml(fallback)}</div>`;
    }
  } catch (e) {
    const fallback = _modalItem?.detail || 'Could not load original message.';
    origEl.innerHTML = `<div class="text-zinc-500 italic text-[12px] mb-2">Original message not available. Showing briefing summary:</div><div>${escapeHtml(fallback)}</div>`;
  }
}

async function fetchDraftReply(itemId) {
  const loadingEl = document.getElementById('dm-draft-loading');
  const textareaEl = document.getElementById('dm-draft-textarea');
  try {
    const res = await fetch(`${API}/api/draft-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok || !data.draft) {
      throw new Error(data.error || 'No draft returned');
    }
    loadingEl.classList.add('hidden');
    textareaEl.classList.remove('hidden');
    textareaEl.value = data.draft;
    if (_modalItemId) textareaEl.focus();

    // Enable action buttons
    document.getElementById('dm-btn-save').disabled = false;
    document.getElementById('dm-btn-copy').disabled = false;
    document.getElementById('dm-btn-regen').disabled = false;
  } catch (e) {
    loadingEl.innerHTML = `<span class="text-ios-red">Draft failed: ${escapeHtml(e.message)}</span>`;
    document.getElementById('dm-btn-regen').disabled = false;
  }
}

async function regenDraft() {
  if (!_modalItemId) return;
  const loadingEl = document.getElementById('dm-draft-loading');
  const textareaEl = document.getElementById('dm-draft-textarea');
  loadingEl.classList.remove('hidden');
  loadingEl.innerHTML = '<span class="spinner"></span> Regenerating...';
  textareaEl.classList.add('hidden');
  document.getElementById('dm-btn-save').disabled = true;
  document.getElementById('dm-btn-copy').disabled = true;
  document.getElementById('dm-btn-regen').disabled = true;
  document.getElementById('dm-status').textContent = '';
  await fetchDraftReply(_modalItemId);
}

async function copyDraft() {
  const textarea = document.getElementById('dm-draft-textarea');
  const status = document.getElementById('dm-status');
  try {
    await navigator.clipboard.writeText(textarea.value);
    status.textContent = 'Copied to clipboard';
    setTimeout(() => { if (status.textContent === 'Copied to clipboard') status.textContent = ''; }, 2500);
  } catch (e) {
    status.textContent = 'Copy failed';
  }
}

async function saveDraftAndOpen() {
  if (!_modalItemId || !_modalItem) return;
  const textarea = document.getElementById('dm-draft-textarea');
  const saveBtn = document.getElementById('dm-btn-save');
  const status = document.getElementById('dm-status');
  const draftBody = textarea.value.trim();
  if (!draftBody) { status.textContent = 'Draft is empty'; return; }

  const ch = _modalItem.channel || 'email';

  // For Teams: just copy to clipboard and open deep link
  if (ch === 'teams') {
    await navigator.clipboard.writeText(draftBody);
    const sourceUrl = getSourceUrl(_modalItem);
    if (sourceUrl) openWindow(sourceUrl);
    status.textContent = 'Copied. Opening Teams...';
    return;
  }

  // For mail sources: save via server
  saveBtn.disabled = true;
  status.textContent = 'Saving draft...';

  try {
    const res = await fetch(`${API}/api/save-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: _modalItemId, body: draftBody }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Save failed');
    status.innerHTML = '<span class="text-ios-green">Draft saved! Opening mail client...</span>';

    // Open the mail client to the drafts folder
    const draftUrls = {
      'outlook-work': 'https://outlook.office365.com/mail/drafts',
      'outlook-personal': 'https://outlook.live.com/mail/drafts',
      email: 'https://outlook.office365.com/mail/drafts',
      gmail: 'https://mail.google.com/#drafts',
      hmbl: 'https://outlook.office365.com/mail/drafts',
    };
    const url = draftUrls[ch] || draftUrls.email;
    setTimeout(() => openWindow(url), 500);
  } catch (e) {
    status.innerHTML = `<span class="text-ios-red">Save failed: ${escapeHtml(e.message)}</span>`;
    saveBtn.disabled = false;
  }
}

// Infer a send source for a waiting-on entry from its detail string
function inferNudgeChannel(entry) {
  const blob = `${entry.detail || ''} ${entry.item || ''}`.toLowerCase();
  if (blob.includes('teams')) return 'teams';
  if (blob.includes('imessage') || blob.includes('text message')) return 'imessage';
  if (blob.includes('email')) return 'email';
  return 'email';
}

// Best-effort recipient hint from the entry. Real address resolution stays in
// the user's mail client; we just pre-fill the To: with the display name.
function nudgeRecipient(entry) {
  return entry.person || '';
}

function openNudgeChannel(entry, body) {
  const channel = inferNudgeChannel(entry);
  const subject = `Following up: ${entry.item || 'our last conversation'}`;
  if (channel === 'email') {
    // mailto: works for both work and personal mail clients
    const url = `mailto:${encodeURIComponent(nudgeRecipient(entry))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank');
    return 'Opened mail compose. Review and send.';
  }
  if (channel === 'teams') {
    // Teams deep link supports a prefilled message via &message=
    const url = `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(nudgeRecipient(entry))}&message=${encodeURIComponent(body)}`;
    window.open(url, '_blank');
    return 'Opened Teams chat. Review and send.';
  }
  return 'No auto-send for this source — copy the text above.';
}

async function nudgeOne(idx) {
  const el = document.getElementById(`nudge-result-${idx}`);
  if (!el) return;
  el.classList.remove('hidden');
  el.innerHTML = '<span class="spinner"></span> Drafting nudge...';
  try {
    const res = await fetch(`${API}/api/draft-nudge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index: idx })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'draft failed');
    const entry = data.entry || {};
    const channel = inferNudgeChannel(entry);
    const nudgeSourceLabel = channel === 'email' ? 'Email' : channel === 'teams' ? 'Teams' : channel;
    // Stash draft on the element so the action handlers can read it back
    el.dataset.draft = data.draft;
    el.dataset.idx = String(idx);
    el.innerHTML = `
      <div class="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <span>Draft nudge</span>
        <span class="text-zinc-600">·</span>
        <span class="text-ios-indigo">${escapeHtml(nudgeSourceLabel)}</span>
        <span class="ml-auto text-zinc-600">to ${escapeHtml(entry.person || '')}</span>
      </div>
      <textarea id="nudge-text-${idx}" class="w-full min-h-[120px] bg-zinc-900/60 border border-white/10 hairline rounded-md p-2 text-[12px] text-zinc-100 leading-relaxed font-sans resize-y focus:outline-none focus:border-ios-indigo/50">${escapeHtml(data.draft)}</textarea>
      <div class="mt-2 flex flex-wrap gap-2 items-center">
        <button class="btn-primary" data-action="approveNudge" data-args='${escapeAttr(JSON.stringify([idx]))}'>Approve & Open ${escapeHtml(nudgeSourceLabel)}</button>
        <button class="btn-secondary" data-action="copyNudge" data-args='${escapeAttr(JSON.stringify([idx]))}'>Copy</button>
        <button class="btn-secondary" data-action="discardNudge" data-args='${escapeAttr(JSON.stringify([idx]))}'>Discard</button>
        <span id="nudge-status-${idx}" class="text-[11px] text-zinc-500"></span>
      </div>`;
  } catch (e) {
    el.innerHTML = `<span class="text-ios-red">Nudge draft failed: ${escapeHtml(e.message)}</span>`;
  }
}

function _currentNudge(idx) {
  const ta = document.getElementById(`nudge-text-${idx}`);
  return ta ? ta.value : '';
}

async function copyNudge(idx) {
  const body = _currentNudge(idx);
  try {
    await navigator.clipboard.writeText(body);
    const s = document.getElementById(`nudge-status-${idx}`);
    if (s) { s.textContent = 'Copied to clipboard.'; setTimeout(() => s.textContent = '', 2500); }
  } catch (e) { console.error('copy failed', e); }
}

function approveNudge(idx) {
  const body = _currentNudge(idx);
  if (!body.trim()) return;
  // Reconstruct entry from the current briefing snapshot
  const entry = (briefing?.accountability?.waitingOn || [])[idx] || {};
  const status = openNudgeChannel(entry, body);
  const s = document.getElementById(`nudge-status-${idx}`);
  if (s) s.textContent = status;
}

async function dismissWaiting(idx) {
  // Optimistic UI: drop the row immediately, then call the server.
  // SSE will push the canonical state back when the write lands.
  if (!briefing?.accountability?.waitingOn?.[idx]) return;
  const removed = briefing.accountability.waitingOn[idx];
  briefing.accountability.waitingOn.splice(idx, 1);
  briefing.accountability.waitingOnOthers = briefing.accountability.waitingOn.length;
  briefing.accountability.stale = briefing.accountability.waitingOn.filter(w => w.stale).length;
  render();
  actionInFlight++;
  try {
    const res = await fetch(`${API}/api/dismiss-waiting`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person: removed.person, item: removed.item, source: 'ui' })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error('dismiss-waiting failed, reloading', e);
  }
  await syncAfterActions();
}

// --- Accountability item actions (overdue / approaching) ---

function _getAccList(type) {
  const acc = briefing?.accountability;
  if (!acc) return [];
  return acc[type] || [];
}

function completeAccItem(type, idx) {
  const list = _getAccList(type);
  if (idx < 0 || idx >= list.length) return;
  const card = document.querySelector(`[data-acc-type="${type}"][data-acc-idx="${idx}"]`);
  if (card) { card.style.opacity = '0.3'; }
  list.splice(idx, 1);
  setTimeout(() => render(), 400);
  actionInFlight++;
  fetch(`${API}/api/complete-accountability`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, index: idx, source: 'ui' })
  }).then(() => syncAfterActions()).catch(e => { console.error('complete-accountability failed', e); syncAfterActions(); });
}

function dismissAccItem(type, idx) {
  const list = _getAccList(type);
  if (idx < 0 || idx >= list.length) return;
  const card = document.querySelector(`[data-acc-type="${type}"][data-acc-idx="${idx}"]`);
  if (card) { card.style.opacity = '0'; }
  list.splice(idx, 1);
  setTimeout(() => render(), 400);
  actionInFlight++;
  fetch(`${API}/api/dismiss-accountability`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, index: idx, source: 'ui' })
  }).then(() => syncAfterActions()).catch(e => { console.error('dismiss-accountability failed', e); syncAfterActions(); });
}

async function draftAccItem(type, idx) {
  const el = document.getElementById(`acc-result-${type}-${idx}`);
  if (!el) return;
  el.classList.remove('hidden');
  el.innerHTML = '<span class="spinner"></span> Generating draft...';
  try {
    const list = _getAccList(type);
    const item = list[idx];
    const text = typeof item === 'string' ? item : (item?.text || item?.item || '');
    const person = typeof item === 'object' ? (item?.person || '') : '';
    const res = await fetch(`${API}/api/draft-reply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accType: type, accIndex: idx, text, person })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    el.innerHTML = `${escapeHtml(data.draft || '')}
      <div class="mt-3 flex gap-2">
        <button class="btn-secondary" data-action="copyAccDraft" data-args='${escapeAttr(JSON.stringify([type, idx]))}'>Copy</button>
        <button class="btn-secondary" data-action="discardAccDraft" data-args='${escapeAttr(JSON.stringify([type, idx]))}'>Discard</button>
      </div>`;
  } catch (e) {
    el.innerHTML = `<span class="text-ios-red">Draft failed: ${escapeHtml(e.message)}</span>`;
  }
}

// ============================================================
// ICONS
// ============================================================

function iconCalendar() { return `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`; }
function iconInbox() { return `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`; }
function iconCheck() { return `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`; }
function iconPen() { return `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`; }

// ============================================================
// BUTTON STYLES (defined as Tailwind classes via custom selectors)
// ============================================================
// We apply these via a small style injection so we can reuse `class="btn-primary"` etc.
const styleEl = document.createElement('style');
styleEl.textContent = `
  .btn-primary { display:inline-flex; align-items:center; justify-content:center; gap:.375rem; height:2rem; padding:0 .75rem; border-radius:.5rem; font-size:.75rem; font-weight:600; background:#0a84ff; color:#fff; transition:background .15s; }
  .btn-primary:hover:not(:disabled) { background:#0a74e0; }
  .btn-primary:disabled { opacity:.4; cursor:not-allowed; }
  .btn-secondary { display:inline-flex; align-items:center; justify-content:center; gap:.375rem; height:2rem; padding:0 .75rem; border-radius:.5rem; font-size:.75rem; font-weight:500; background:rgba(255,255,255,.05); color:#e4e4e7; border:1px solid rgba(255,255,255,.1); transition:background .15s, border-color .15s; }
  .btn-secondary:hover:not(:disabled) { background:rgba(255,255,255,.1); border-color:rgba(255,255,255,.15); }
`;
document.head.appendChild(styleEl);

// ============================================================
// LIVE UPDATES (Server-Sent Events) + INIT
// ============================================================
//
// We connect once to /api/events and re-fetch the briefing whenever the server
// announces a change. EventSource auto-reconnects on transient drops. As a
// safety net (in case of stuck connections behind a sleeping laptop, suspended
// proxy, etc.) we keep a slow 2-min poll that only fires if SSE has been quiet.

let sse = null;
let lastEventAt = Date.now();
let lastSeenUpdate = null;

// --- Action-in-flight tracking ---
// Suppresses SSE re-renders while user actions are pending to prevent
// optimistic UI from being overwritten by stale server state.
let actionInFlight = 0;

async function syncAfterActions() {
  actionInFlight--;
  if (actionInFlight > 0) return;
  // All actions resolved — fetch authoritative state and render once.
  try {
    const res = await fetch(`${API}/api/briefing`);
    if (!res.ok) return;
    briefing = await res.json();
    lastSeenUpdate = briefing.lastUpdated;
    render();
  } catch (e) { console.error('post-action sync failed', e); }
}

function connectSSE() {
  try {
    if (sse) sse.close();
    sse = new EventSource(`${API}/api/events`);
    sse.addEventListener('hello', (e) => {
      lastEventAt = Date.now();
      const d = JSON.parse(e.data);
      lastSeenUpdate = d.lastUpdated;
    });
    // Server emits a heartbeat every 25s; refresh lastEventAt so the safety
    // net poll doesn't reconnect a perfectly healthy stream.
    sse.addEventListener('ping', () => { lastEventAt = Date.now(); });
    sse.addEventListener('briefing', async (e) => {
      lastEventAt = Date.now();
      const d = JSON.parse(e.data);
      if (d.lastUpdated && d.lastUpdated === lastSeenUpdate) return;
      lastSeenUpdate = d.lastUpdated;
      // Skip re-render while user actions are still in flight to prevent
      // optimistic UI from being overwritten by stale server state.
      if (actionInFlight > 0) return;
      try {
        const res = await fetch(`${API}/api/briefing`);
        if (!res.ok) return;
        briefing = await res.json();
        render();
      } catch (err) { console.error('SSE refetch failed', err); }
    });
    // Live-update the draft modal as the LLM produces output. The server
    // emits draft-progress with the running buffer; we only paint if the
    // modal is open for the matching item.
    sse.addEventListener('draft-progress', (e) => {
      lastEventAt = Date.now();
      try {
        const d = JSON.parse(e.data);
        if (!_modalItemId || d.itemId !== _modalItemId) return;
        const textareaEl = document.getElementById('dm-draft-textarea');
        const loadingEl = document.getElementById('dm-draft-loading');
        if (loadingEl) loadingEl.classList.add('hidden');
        if (textareaEl) {
          textareaEl.classList.remove('hidden');
          // Don't overwrite if the user has started editing
          if (!textareaEl.dataset.userEdited) textareaEl.value = d.text || '';
        }
      } catch {}
    });
    sse.addEventListener('draft-ready', (e) => {
      lastEventAt = Date.now();
      try {
        const d = JSON.parse(e.data);
        if (!_modalItemId || d.itemId !== _modalItemId) return;
        const textareaEl = document.getElementById('dm-draft-textarea');
        if (textareaEl && !textareaEl.dataset.userEdited) {
          textareaEl.value = d.text || '';
          textareaEl.focus();
        }
      } catch {}
    });
    sse.addEventListener('regenerating', () => {
      lastEventAt = Date.now();
      showRegenBanner();
    });
    sse.addEventListener('regenerate-done', async (e) => {
      lastEventAt = Date.now();
      hideRegenBanner();
      const d = JSON.parse(e.data);
      if (d.ok) {
        // Re-fetch the fresh briefing
        try {
          const res = await fetch(`${API}/api/briefing`);
          if (res.ok) { briefing = await res.json(); render(); }
        } catch (err) { console.error('Post-regen fetch failed', err); }
      }
    });
    sse.addEventListener('job-started', (e) => {
      lastEventAt = Date.now();
      try {
        const d = JSON.parse(e.data);
        const btn = document.querySelector(`button[data-script="${d.script}"]`);
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Running'; btn.classList.add('opacity-50', 'cursor-wait'); }
      } catch {}
    });
    sse.addEventListener('job-done', async (e) => {
      lastEventAt = Date.now();
      try {
        const d = JSON.parse(e.data);
        const btn = document.querySelector(`button[data-script="${d.script}"]`);
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('opacity-50', 'cursor-wait');
          btn.textContent = d.ok ? '✓ Done' : '✗ Failed';
          btn.classList.add(d.ok ? 'text-ios-green' : 'text-ios-red');
          setTimeout(() => { btn.textContent = '▶ Run'; btn.classList.remove('text-ios-green', 'text-ios-red'); }, 5000);
        }
        // Refresh health status after job completion
        await loadHealth();
        render();
      } catch {}
    });
    sse.onerror = () => {
      // EventSource will auto-retry; nothing to do unless the page is hidden.
      // The fallback poll below covers prolonged dead connections.
    };
  } catch (err) {
    console.warn('SSE not available, falling back to polling', err);
  }
}

connectSSE();

// Mark the draft textarea as user-edited on first input so SSE draft-progress
// events can't overwrite in-flight edits.
(() => {
  const ta = document.getElementById('dm-draft-textarea');
  if (ta) ta.addEventListener('input', () => { ta.dataset.userEdited = '1'; });
})();

// ============================================================
// EVENT DELEGATION
// ============================================================
//
// All click handlers are wired through a single delegated listener instead of
// inline `onclick=...` attributes. Each interactive element carries:
//   data-action="functionName"
//   data-args='[...]'         (JSON array of args, optional)
// This lets us tighten CSP later by removing 'unsafe-inline' from script-src.

function discardNudge(idx) {
  const el = document.getElementById(`nudge-result-${idx}`);
  if (el) el.classList.add('hidden');
}

function copyAccDraft(type, idx) {
  const el = document.getElementById(`acc-result-${type}-${idx}`);
  if (!el) return;
  const txt = el.dataset.draft || el.innerText;
  navigator.clipboard.writeText(txt).catch(e => console.error('copy failed', e));
}

function discardAccDraft(type, idx) {
  const el = document.getElementById(`acc-result-${type}-${idx}`);
  if (el) el.classList.add('hidden');
}

const ACTION_REGISTRY = {
  setFilter, openWindow, manualRefresh, toggleStatus, toggleLowPriority,
  toggleItem, dismissItem, undoItem,
  draftOne, closeDraftModal, saveDraftAndOpen, copyDraft, regenDraft,
  nudgeOne, approveNudge, copyNudge, discardNudge,
  draftAccItem, completeAccItem, dismissAccItem, copyAccDraft, discardAccDraft,
  dismissWaiting,
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTION_REGISTRY[el.dataset.action];
  if (typeof fn !== 'function') {
    console.warn('Unknown data-action:', el.dataset.action);
    return;
  }
  let args = [];
  if (el.dataset.args) {
    try { args = JSON.parse(el.dataset.args); }
    catch (err) { console.error('Bad data-args:', el.dataset.args, err); return; }
  }
  e.preventDefault();
  fn(...args);
});

// Refresh health independently (cheap, gives the dot in the header)
setInterval(loadHealth, 60_000);

// Time-aware re-render every 60s: updates meeting past/now/next badges,
// relative timestamps, and other time-dependent UI without refetching data.
// SSE handles data changes; this just keeps the clock-based UI fresh.
setInterval(() => { if (briefing) render(); }, 60_000);

// Safety-net poll: only fires if we haven't heard from the server in 2 minutes.
setInterval(async () => {
  if (Date.now() - lastEventAt < 120_000) return;
  try {
    const res = await fetch(`${API}/api/briefing`);
    if (!res.ok) return;
    const fresh = await res.json();
    if (!briefing || fresh.lastUpdated !== briefing.lastUpdated) {
      briefing = fresh;
      lastSeenUpdate = fresh.lastUpdated;
      render();
    }
  } catch { /* silent */ }
  // Try to revive the SSE channel if it's been silent
  connectSSE();
}, 60_000);

// Re-poll once on tab focus (covers laptop wake from sleep)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastEventAt > 30_000) connectSSE();
});

load();
