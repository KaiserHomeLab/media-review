// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// The Owner's page: the Review Queue with its decisions, and the optional API key for Media Ops.
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
  const keep = el('button', 'btn small', 'Keep');
  keep.type = 'button';
  keep.addEventListener('click', async () => {
    if (!confirm(`Keep ${e.title.name}? All its Downvotes are cleared, so it starts again from zero.`)) return;
    keep.disabled = true;
    fail('');
    try {
      await api(`/api/owner/review-queue/${encodeURIComponent(e.title.ratingKey)}/keep`, {
        method: 'POST',
        body: '{}',
      });
    } catch (err) {
      // Already decided, perhaps in Media Ops: the reload below shows where it stands.
      if (err.message !== 'not-queued') fail(err.message);
    }
    loadQueue();
  });
  acts.append(keep);

  li.append(img, main, acts);
  return li;
}

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

Promise.all([loadQueue(), api('/api/owner/api-key').then(({ apiKey }) => showKey(apiKey))])
  .then(() => {
    $('queue-card').hidden = false;
    $('key-card').hidden = false;
  })
  .catch(e => fail(e.message === 'sign in first' ? 'Sign in as the Owner first.' : e.message));
// Keep it current while it's open, e.g. after a decision made in Media Ops.
setInterval(() => loadQueue().catch(() => {}), 60000);
