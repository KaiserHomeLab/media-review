// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// The Owner's page: the Review Queue, Problem Reports, Leaving Soon and what's held back, with their decisions. Settings has its own page.
// The same decisions can be made in Media Ops; both go to the same place.
'use strict';

const $ = id => /** @type {HTMLElement} */ (document.getElementById(id));
const el = (/** @type {string} */ tag, /** @type {string} */ cls, /** @type {string} */ text = '') =>
  Object.assign(document.createElement(tag), { className: cls, textContent: text });

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' } });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

function fail(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

const num = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function entry(e) {
  const li = el('li', 'entry');
  const img = el(e.title.poster ? 'img' : 'div', 'poster');
  // The entry's poster link is for Media Ops (API key); the Owner's session uses the web app's own.
  if (e.title.poster) Object.assign(img, { src: `/poster/${encodeURIComponent(e.title.ratingKey)}`, alt: '' });

  const main = el('div', 'main');
  const head = el('div', 'head');
  head.append(el('b', '', e.title.name));
  if (e.title.year) head.append(el('span', 'muted', ` (${e.title.year})`));
  const chips = el('div', 'meta');
  chips.append(el('span', 'chip', e.title.library ?? (e.title.kind === 'show' ? 'Show' : 'Movie')));
  chips.append(el('span', 'chip kind', `▼ ${e.downvotes.length} Downvote${e.downvotes.length === 1 ? '' : 's'}`));
  if (e.sentBack) chips.append(el('span', 'chip review', 'Sent back by Objections'));
  if (e.history.some(h => h.decision === 'keep')) {
    const kept = e.history.filter(h => h.decision === 'keep').length;
    chips.append(el('span', 'chip', kept === 1 ? 'Kept once before' : `Kept ${kept} times before`));
  }
  main.append(
    head,
    chips,
    el(
      'div',
      'line',
      `${num(e.downvoteWeight)} of ${num(e.audienceWeight)} weight from an Audience of ${e.audience} · queued ${ago(e.queuedAt)}`,
    ),
    el('div', 'line', `Downvoted by ${e.downvotes.map(d => `${d.voter} (${num(d.voteWeight)})`).join(', ')}`),
  );
  if (e.objections.length)
    main.append(
      el('div', 'line', `Objected: ${e.objections.map(o => `${o.voter} (${num(o.voteWeight)})`).join(', ')}`),
    );
  if (e.watchedSinceQueued.length)
    main.append(el('div', 'line', `Watched it since: ${e.watchedSinceQueued.map(w => w.voter).join(', ')}`));

  const acts = el('div', 'acts');
  acts.append(
    decide(
      e.title,
      'review-queue',
      'keep',
      'Keep',
      `Keep ${e.title.name}? All its Downvotes are cleared, so it starts again from zero.`,
    ),
    decide(
      e.title,
      'review-queue',
      'remove',
      'Remove',
      `Remove ${e.title.name}? It goes to Leaving Soon for ${leavingDays} days, pinned in Plex for everyone, and only then is it deleted.`,
      'btn small danger',
    ),
  );

  li.append(img, main, acts);
  return li;
}

// A decision button: Keep or Remove in the queue, or Keep after all while Leaving Soon.
/**
 * @param {{ ratingKey: string, name: string }} title @param {'review-queue' | 'leaving-soon' | 'building-up'} list
 * @param {'keep' | 'remove'} what @param {string} label @param {string} question @param {string} [cls]
 */
function decide(title, list, what, label, question, cls = 'btn small') {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', async () => {
    if (!confirm(question)) return;
    b.disabled = true;
    fail('');
    try {
      await api(`/api/owner/${list}/${encodeURIComponent(title.ratingKey)}/${what}`, { method: 'POST', body: '{}' });
    } catch (err) {
      // Already decided, perhaps in Media Ops: the reload below shows where it stands.
      if (!['not-queued', 'not-leaving', 'not-building-up'].includes(err.message)) fail(err.message);
    }
    loadAll();
  });
  return b;
}

/** @param {number} days */
const leavingText = days => (days <= 0 ? 'leaves today' : days === 1 ? 'leaves tomorrow' : `leaves in ${days} days`);

// One Leaving Soon Title: when it goes, and Keep after all.
function leavingEntry(l) {
  const li = el('li', 'entry');
  const img = el('img', 'poster');
  Object.assign(img, { src: `/poster/${encodeURIComponent(l.ratingKey)}`, alt: '' });
  const main = el('div', 'main');
  const head = el('div', 'head');
  head.append(el('b', '', l.name));
  if (l.year) head.append(el('span', 'muted', ` (${l.year})`));
  const chips = el('div', 'meta');
  chips.append(el('span', 'chip', l.library ?? (l.kind === 'show' ? 'Show' : 'Movie')));
  chips.append(el('span', 'chip kind', `⏳ ${leavingText(l.daysLeft)}`));
  main.append(
    head,
    chips,
    el(
      'div',
      'line',
      `Removed ${ago(l.removedAt)} · deleted overnight on ${new Date(l.endsAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`,
    ),
  );
  // Overnight deletion didn't happen: say why. It's tried again the next night.
  // How close friends' Objections are to sending it back.
  if (!l.objectionsOpen) main.append(el('div', 'line', 'Sent back once already: no Objections this time'));
  else if (l.objections?.length)
    main.append(
      el(
        'div',
        'line',
        `Objections: ${num(l.objectionWeight)} of ${num(l.objectionBar)} · ${l.objections.map(o => `${o.voter} (${num(o.voteWeight)})`).join(', ')}`,
      ),
    );
  if (l.deleteError) main.append(el('div', 'line problem', `Couldn't delete: ${l.deleteError}. Tried again tonight.`));
  const acts = el('div', 'acts');
  acts.append(
    decide(
      { ratingKey: l.ratingKey, name: l.name },
      'leaving-soon',
      'keep',
      'Keep after all',
      `Keep ${l.name} after all? It leaves Leaving Soon and the Plex collection, and its Downvotes are cleared.`,
    ),
  );
  li.append(img, main, acts);
  return li;
}

// One open Problem Report: what's wrong, everyone who has it, and Resolve or Close with an optional note.
function problemEntry(r) {
  const li = el('li', 'entry');
  const img = el(r.title.poster ? 'img' : 'div', 'poster');
  if (r.title.poster) Object.assign(img, { src: `/poster/${encodeURIComponent(r.title.ratingKey)}`, alt: '' });
  const main = el('div', 'main');
  const head = el('div', 'head');
  head.append(el('b', '', r.title.name ?? r.title.ratingKey));
  if (r.title.year) head.append(el('span', 'muted', ` (${r.title.year})`));
  const chips = el('div', 'meta');
  chips.append(el('span', 'chip', r.title.library ?? (r.title.kind === 'show' ? 'Show' : 'Movie')));
  chips.append(el('span', 'chip kind', `⚑ ${r.reasonLabel}`));
  if (r.part) chips.append(el('span', 'chip', r.part));
  else if (r.title.kind === 'show') chips.append(el('span', 'chip', 'Whole show'));
  main.append(head, chips);
  for (const p of r.reporters)
    main.append(el('div', 'line', `${p.voter} · ${ago(p.at)}${p.note ? `: “${p.note}”` : ''}`));
  const note = Object.assign(el('input', 'note-in'), {
    placeholder: 'Note for them (optional), e.g. replaced with a 1080p copy',
    maxLength: 500,
  });
  main.append(note);

  const acts = el('div', 'acts');
  for (const [what, label, cls, tip] of [
    ['resolve', 'Resolve', 'btn small', "Fixed: they're told it's resolved"],
    ['close', 'Close', 'btn small ghost', "Not fixing it: they're told it's closed"],
  ]) {
    const b = el('button', cls, label);
    b.type = 'button';
    b.title = tip;
    b.addEventListener('click', async () => {
      b.disabled = true;
      fail('');
      try {
        await api(`/api/owner/problem-reports/${r.id}/${what}`, {
          method: 'POST',
          body: JSON.stringify({ note: note.value }),
        });
      } catch (err) {
        // Already dealt with, perhaps in Media Ops: the reload shows where it stands.
        if (err.message !== 'not-open') fail(err.message);
      }
      loadAll();
    });
    acts.append(b);
  }
  li.append(img, main, acts);
  return li;
}

// One Title building up: how close it is to the bar, who Downvoted (and who hasn't tried it yet), and Keep now
// or Remove now.
function buildingEntry(b) {
  const li = el('li', 'entry');
  const img = el(b.title.poster ? 'img' : 'div', 'poster');
  if (b.title.poster) Object.assign(img, { src: `/poster/${encodeURIComponent(b.title.ratingKey)}`, alt: '' });
  const main = el('div', 'main');
  const head = el('div', 'head');
  head.append(el('b', '', b.title.name ?? b.title.ratingKey));
  if (b.title.year) head.append(el('span', 'muted', ` (${b.title.year})`));
  const chips = el('div', 'meta');
  chips.append(el('span', 'chip', b.title.library ?? (b.title.kind === 'show' ? 'Show' : 'Movie')));
  chips.append(el('span', 'chip kind', `▽ ${b.downvotes.length} Downvote${b.downvotes.length === 1 ? '' : 's'}`));
  const bar = el('div', 'bar-mini');
  const fill = el('i', '');
  fill.style.width = `${Math.round(b.progress * 100)}%`;
  bar.append(fill);
  bar.title = `${Math.round(b.progress * 100)}% of the way to the Review Queue`;
  const short = b.audience < b.minimumAudience;
  main.append(
    head,
    chips,
    bar,
    el(
      'div',
      'line',
      `${num(b.downvoteWeight)} weight, ${num(b.neededWeight)} needed · ${b.audience} of ${b.minimumAudience} have tried it${short ? ' (too few yet)' : ''} · first ${ago(b.firstAt)}`,
    ),
    el(
      'div',
      'line',
      `Downvoted by ${b.downvotes.map(d => (d.counts ? `${d.voter} (${num(d.voteWeight)})` : `${d.voter} (not tried yet)`)).join(', ')}`,
    ),
  );
  const acts = el('div', 'acts');
  acts.append(
    decide(
      b.title,
      'building-up',
      'keep',
      'Keep now',
      `Keep ${b.title.name}? Its Downvotes are cleared, so it starts again from zero.`,
    ),
    decide(
      b.title,
      'building-up',
      'remove',
      'Remove now',
      `Remove ${b.title.name} now, before it reaches the bar? It goes to Leaving Soon for ${leavingDays} days, pinned in Plex for everyone, and only then is it deleted.`,
      'btn small danger',
    ),
  );
  li.append(img, main, acts);
  return li;
}

async function loadBuilding() {
  const { buildingUp } = await api('/api/owner/building-up');
  $('building-count').textContent = buildingUp.length ? `${buildingUp.length} with Downvotes` : 'none';
  $('building').replaceChildren(...buildingUp.map(buildingEntry));
  if (!buildingUp.length) $('building').append(el('li', 'empty', 'Nothing has Downvotes below the bar.'));
}

async function loadProblems() {
  const { problemReports } = await api('/api/owner/problem-reports');
  $('problems-count').textContent = problemReports.length ? `${problemReports.length} open` : 'none open';
  $('problems').replaceChildren(...problemReports.map(problemEntry));
  if (!problemReports.length) $('problems').append(el('li', 'empty', 'No open Problem Reports.'));
}

const day = (/** @type {string} */ iso) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// One held-back Title: who asked for it, why it went, and Bring back (off Seerr's blocklist and requested) or
// Decline, with a note for the friends who asked.
function heldEntry(h) {
  const li = el('li', 'entry');
  const img = el(h.title.poster ? 'img' : 'div', 'poster');
  if (h.title.poster) Object.assign(img, { src: `/poster/${encodeURIComponent(h.title.ratingKey)}`, alt: '' });
  const main = el('div', 'main');
  const head = el('div', 'head');
  head.append(el('b', '', h.title.name ?? h.title.ratingKey));
  if (h.title.year) head.append(el('span', 'muted', ` (${h.title.year})`));
  const chips = el('div', 'meta');
  chips.append(el('span', 'chip', h.title.library ?? (h.title.kind === 'show' ? 'Show' : 'Movie')));
  chips.append(
    el(
      'span',
      'chip kind',
      h.asks.length ? `↺ ${h.asks.length} ask${h.asks.length === 1 ? '' : 's'}` : `↺ Deleted ${day(h.deletedAt)}`,
    ),
  );
  main.append(head, chips);
  for (const a of h.asks)
    main.append(el('div', 'line', `${a.voter} asked ${ago(a.at)}${a.note ? `: “${a.note}”` : ''}`));

  // Why it went: each Remove's Downvotes and Objections, then the Keeps, Removes and deletions in order.
  const w = (/** @type {any[]} */ xs) =>
    xs.map(x => (x.voteWeight == null ? x.voter : `${x.voter} (${num(x.voteWeight)})`)).join(', ');
  for (const r of h.history.votes) {
    if (r.downvotes.length) main.append(el('div', 'line', `Downvoted, as of ${day(r.at)}: ${w(r.downvotes)}`));
    if (r.objections.length) main.append(el('div', 'line', `Objected, as of ${day(r.at)}: ${w(r.objections)}`));
  }
  const events = [
    ...h.history.decisions.map(d => ({ at: d.at, text: `${d.decision === 'keep' ? 'Kept' : 'Removed'} ${day(d.at)}` })),
    ...h.history.deletions.map(d => ({ at: d.at, text: `Deleted ${day(d.at)} from ${d.from.join(' and ')}` })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  if (events.length) main.append(el('div', 'line', events.map(e => e.text).join(' · ')));
  if (h.blockError) main.append(el('div', 'line problem', `Not blocked in Seerr: ${h.blockError}`));

  const note = Object.assign(el('input', 'note-in'), {
    placeholder: h.asks.length ? 'Note for them (optional)' : 'Note (optional)',
    maxLength: 500,
  });
  if (h.asks.length) main.append(note);
  const acts = el('div', 'acts');
  const choices = [['bring-back', 'Bring back', 'btn small primary']];
  if (h.asks.length) choices.push(['decline', 'Decline', 'btn small ghost']);
  for (const [what, label, cls] of choices) {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      if (
        what === 'bring-back' &&
        !confirm(`Bring back ${h.title.name}? It comes off Seerr's blocklist and is requested there, approved.`)
      )
        return;
      b.disabled = true;
      fail('');
      try {
        await api(`/api/owner/held-back/${encodeURIComponent(h.title.ratingKey)}/${what}`, {
          method: 'POST',
          body: JSON.stringify({ note: note.value }),
        });
      } catch (err) {
        if (err.message !== 'not-gone') fail(err.message);
      }
      loadAll();
    });
    acts.append(b);
  }
  li.append(img, main, acts);
  return li;
}

async function loadHeld() {
  const { heldBack } = await api('/api/owner/held-back');
  const asked = heldBack.filter(h => h.asks.length);
  const rest = heldBack.filter(h => !h.asks.length);
  $('held-count').textContent = `${asked.length ? `${asked.length} asked for · ` : ''}${heldBack.length} held back`;
  $('held').replaceChildren(...asked.map(heldEntry));
  if (!asked.length) $('held').append(el('li', 'empty', 'Nobody has asked for anything back.'));
  // The rest, folded away: there can be a lot of them over time.
  $('more-held').hidden = !rest.length;
  $('more-held-label').textContent = `Everything else held back (${rest.length})`;
  $('held-rest').replaceChildren(...rest.map(heldEntry));
}

async function loadLeaving() {
  const { leavingSoon } = await api('/api/owner/leaving-soon');
  $('leaving-count').textContent = leavingSoon.length ? `${leavingSoon.length} leaving` : 'nothing leaving';
  $('leaving').replaceChildren(...leavingSoon.map(leavingEntry));
  if (!leavingSoon.length) $('leaving').append(el('li', 'empty', 'Nothing is Leaving Soon.'));
}

// The Leaving Soon length, for Remove's question (Settings → Rules).
let leavingDays = 14;
const loadAll = () =>
  Promise.all([
    loadQueue(),
    loadBuilding(),
    loadProblems(),
    loadLeaving(),
    loadHeld(),
    api('/api/owner/rules')
      .then(r => (leavingDays = r.rules.leavingSoonDays))
      .catch(() => {}),
  ]);

async function loadQueue() {
  const { reviewQueue } = await api('/api/owner/review-queue');
  $('queue-count').textContent = reviewQueue.length ? `${reviewQueue.length} to decide` : 'nothing to decide';
  $('queue').replaceChildren(...reviewQueue.map(entry));
  if (!reviewQueue.length) $('queue').append(el('li', 'empty', 'Nothing waiting for review.'));
}

loadAll()
  .then(() => {
    $('queue-card').hidden = false;
    $('building-card').hidden = false;
    $('problems-card').hidden = false;
    $('leaving-card').hidden = false;
    $('held-card').hidden = false;
  })
  .catch(e => fail(e.message === 'sign in first' ? 'Sign in as the Owner first.' : e.message));
// Keep it current while it's open, e.g. after a decision made in Media Ops.
setInterval(() => loadAll().catch(() => {}), 60000);
