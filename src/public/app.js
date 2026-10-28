// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// The Voter's page: browse Titles and cast Downvotes. A Voter only ever sees their own Downvotes.
'use strict';

const $ = id => /** @type {HTMLElement} */ (document.getElementById(id));

const SIGNIN_ERRORS = {
  failed: 'Plex sign-in did not finish. Try again.',
  'no-access': "That Plex account doesn't have access to this server.",
};

const ERRORS = {
  'already-downvoted': 'You already Downvoted this.',
  queued: 'This is already with the Owner for review.',
  leaving: "This is already Leaving Soon, so it can't be Downvoted.",
  'unknown-title': 'That title is no longer in the library.',
  'not-downvoted': "You hadn't Downvoted this.",
};

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const body = res.status === 204 ? null : await res.json();
  if (!res.ok) throw Object.assign(new Error(body?.error ?? `HTTP ${res.status}`), { status: res.status });
  return body;
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

let me = null;

/** @param {number} days */
const leavingText = days => (days <= 0 ? 'Leaving today' : days === 1 ? 'Leaving tomorrow' : `Leaving in ${days} days`);

const el = (/** @type {string} */ tag, /** @type {string} */ cls, /** @type {string} */ text = '') =>
  Object.assign(document.createElement(tag), { className: cls, textContent: text });

function card(t) {
  const li = el('li', 'tile');
  const img = el(t.poster ? 'img' : 'div', 'poster');
  if (t.poster) Object.assign(img, { src: t.poster, alt: '', loading: 'lazy' });
  const body = el('div', 'body');
  const meta = el('div', 'meta');
  meta.append(el('span', 'chip', t.library ?? (t.kind === 'movie' ? 'Movie' : 'Show')));
  if (t.year) meta.append(el('span', 'chip', String(t.year)));
  if (t.inReview) meta.append(el('span', 'chip review', 'In review'));
  if (t.leavingInDays != null) meta.append(el('span', 'chip review', leavingText(t.leavingInDays)));
  body.append(el('div', 'name', t.title), meta);

  // A Downvote only counts once the Voter has given the Title a real try (a Sample), so say so.
  const leaving = t.leavingInDays != null;
  const untried = !t.sampled && !t.inReview && !leaving && !me.isOwner;
  const tryNote = () => el('div', 'note', `Counts once you've watched ${me.sampleMinutes[t.kind]} minutes of it.`);

  // Downvote, or Withdraw it again, until the Title is with the Owner.
  const action = (/** @type {'downvote' | 'withdraw'} */ what) => {
    const btn = el(
      'button',
      what === 'downvote' ? 'btn small' : 'btn small ghost',
      what === 'downvote' ? '▼ Downvote' : 'Withdraw',
    );
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      showError('');
      try {
        await api(`/api/titles/${encodeURIComponent(t.ratingKey)}/${what}`, { method: 'POST', body: '{}' });
        t.downvoted = what === 'downvote';
      } catch (e) {
        showError(ERRORS[e.message] ?? e.message);
        if (e.message === 'queued') t.inReview = true;
        if (e.message === 'already-downvoted') t.downvoted = true;
        if (e.message === 'not-downvoted') t.downvoted = false;
      }
      li.replaceWith(card(t));
    });
    return btn;
  };

  const acts = el('div', 'acts');
  if (leaving) acts.append(el('div', 'state', 'Watch it before it goes'));
  else if (t.inReview) acts.append(el('div', 'state', 'With the Owner for review'));
  else if (me.isOwner) {
    // the Owner only looks
  } else if (t.downvoted) {
    acts.append(el('div', 'state', 'You Downvoted this'), action('withdraw'));
    if (untried) acts.append(tryNote());
  } else {
    acts.append(action('downvote'));
    if (untried) acts.append(tryNote());
  }
  body.append(acts);
  li.append(img, body);
  return li;
}

// The library tab ('' is All), remembered in this browser only.
const TAB_KEY = 'media-review:library';
let library = '';
try {
  library = localStorage.getItem(TAB_KEY) ?? '';
} catch {}
let query = '';

// The Leaving Soon tab; not a Plex library name, which can't start with a NUL.
const LEAVING = '\u0000leaving';

// One tab per Plex library (Movies, TV Shows, Anime…), named as in Plex, then Leaving Soon when anything is.
async function loadTabs() {
  const [{ libraries }, { leavingSoon }] = await Promise.all([api('/api/libraries'), api('/api/leaving-soon')]);
  if (!libraries.some(l => l.name === library) && !(library === LEAVING && leavingSoon.length)) library = '';
  const tab = (/** @type {string} */ name, /** @type {string} */ label, /** @type {number} */ n) => {
    const b = el('button', '', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(name === library));
    b.append(el('span', 'n', String(n)));
    b.addEventListener('click', () => {
      library = name;
      try {
        localStorage.setItem(TAB_KEY, name);
      } catch {}
      for (const x of $('tabs').children) x.setAttribute('aria-selected', String(x === b));
      load();
    });
    return b;
  };
  const total = libraries.reduce((sum, l) => sum + l.count, 0);
  const tabs = [tab('', 'All', total), ...libraries.map(l => tab(l.name, l.name, l.count))];
  if (leavingSoon.length) {
    const leaving = tab(LEAVING, 'Leaving Soon', leavingSoon.length);
    leaving.classList.add('leaving');
    tabs.push(leaving);
  }
  $('tabs').replaceChildren(...tabs);
  $('tabs').hidden = tabs.length < 3 && !leavingSoon.length;
}

let pending = 0;
async function load() {
  const ticket = ++pending;
  const q = query;
  try {
    const params = new URLSearchParams({ q });
    if (library === LEAVING) params.set('leaving', '1');
    else if (library) params.set('library', library);
    const { titles } = await api(`/api/titles?${params}`);
    if (ticket !== pending) return; // a newer search is on its way
    $('titles').replaceChildren(...titles.map(card));
    $('empty').hidden = titles.length > 0;
    $('count').textContent = `${titles.length}${titles.length === 60 ? '+' : ''} ${q ? 'found' : 'titles'}`;
  } catch (e) {
    showError(e.message);
  }
}

async function start() {
  const err = new URLSearchParams(location.search).get('signin');
  if (err) history.replaceState(null, '', '/');
  try {
    me = await api('/api/me');
  } catch {
    $('signin').hidden = false;
    if (err) {
      $('signin-error').textContent = SIGNIN_ERRORS[err] ?? 'Sign-in failed.';
      $('signin-error').hidden = false;
    }
    return;
  }
  $('who').textContent = me.isOwner ? `${me.username} · Owner` : me.username;
  $('logout').hidden = false;
  $('owner-link').hidden = !me.isOwner;
  $('owner-note').hidden = !me.isOwner;
  if (me.isOwner)
    api('/api/owner/review-queue')
      .then(({ reviewQueue }) => {
        $('queue-badge').textContent = String(reviewQueue.length);
        $('queue-badge').hidden = !reviewQueue.length;
      })
      .catch(() => {});
  $('app').hidden = false;
  let timer;
  $('search').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = /** @type {HTMLInputElement} */ (e.target).value;
      load();
    }, 200);
  });
  await loadTabs().catch(e => showError(e.message));
  load();
}

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' }).catch(() => {});
  location.href = '/';
});

start();
