// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// The Owner's page: the Review Queue and Leaving Soon with their decisions, and the optional API key for Media Ops.
// The same decisions can be made in Media Ops; both go to the same place (ADR 0003).
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
  return `${Math.round(s / 86400)} days ago`;
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
      `Remove ${e.title.name}? It goes to Leaving Soon for 14 days, pinned in Plex for everyone, and only then is it deleted.`,
      'btn small danger',
    ),
  );

  li.append(img, main, acts);
  return li;
}

// A decision button: Keep or Remove in the queue, or Keep after all while Leaving Soon.
/**
 * @param {{ ratingKey: string, name: string }} title @param {'review-queue' | 'leaving-soon'} list
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
      if (err.message !== 'not-queued' && err.message !== 'not-leaving') fail(err.message);
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
  chips.append(el('span', 'chip review', leavingText(l.daysLeft)));
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

async function loadLeaving() {
  const { leavingSoon } = await api('/api/owner/leaving-soon');
  $('leaving-count').textContent = leavingSoon.length ? `${leavingSoon.length} leaving` : 'nothing leaving';
  $('leaving').replaceChildren(...leavingSoon.map(leavingEntry));
  if (!leavingSoon.length) $('leaving').append(el('li', 'empty', 'Nothing is Leaving Soon.'));
}

const loadAll = () => Promise.all([loadQueue(), loadLeaving()]);

async function loadQueue() {
  const { reviewQueue } = await api('/api/owner/review-queue');
  $('queue-count').textContent = reviewQueue.length ? `${reviewQueue.length} to decide` : 'nothing to decide';
  $('queue').replaceChildren(...reviewQueue.map(entry));
  if (!reviewQueue.length) $('queue').append(el('li', 'empty', 'Nothing waiting for review.'));
}

// ------------------------------------------------------------------ the API key for Media Ops
const showKey = key => {
  $('key').textContent = key ?? 'No key yet. Generate one to connect Media Ops.';
  $('generate').textContent = key ? 'Generate a new key' : 'Generate a key';
};

$('generate').addEventListener('click', async () => {
  if (
    !$('key').textContent.startsWith('No key') &&
    !confirm('Replace the current key? Media Ops will need the new one.')
  )
    return;
  try {
    showKey((await api('/api/owner/api-key', { method: 'POST', body: '{}' })).apiKey);
  } catch (e) {
    fail(e.message);
  }
});

Promise.all([loadAll(), api('/api/owner/api-key').then(({ apiKey }) => showKey(apiKey))])
  .then(() => {
    $('queue-card').hidden = false;
    $('leaving-card').hidden = false;
    $('key-card').hidden = false;
  })
  .catch(e => fail(e.message === 'sign in first' ? 'Sign in as the Owner first.' : e.message));
// Keep it current while it's open, e.g. after a decision made in Media Ops.
setInterval(() => loadAll().catch(() => {}), 60000);
