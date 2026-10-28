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

function card(t) {
  const li = document.createElement('li');
  li.className = 'card';
  const img = document.createElement(t.poster ? 'img' : 'div');
  img.className = 'poster';
  if (t.poster) Object.assign(img, { src: t.poster, alt: '', loading: 'lazy' });
  const body = document.createElement('div');
  body.className = 'body';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = t.title;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = [t.kind === 'movie' ? 'Movie' : 'Show', t.year].filter(Boolean).join(' · ');
  body.append(name, meta);

  // A Downvote only counts once the Voter has given the Title a real try (a Sample), so say so.
  const untried = !t.sampled && !t.inReview && !me.isOwner;
  const tryNote = () => {
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = `Counts once you've watched ${me.sampleMinutes[t.kind]} minutes of it.`;
    return note;
  };

  // Downvote, or Withdraw it again, until the Title is with the Owner.
  const action = (/** @type {'downvote' | 'withdraw'} */ what) => {
    const btn = document.createElement('button');
    btn.textContent = what === 'downvote' ? 'Downvote' : 'Withdraw';
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

  if (t.inReview || me.isOwner) {
    const state = document.createElement('div');
    state.className = 'state';
    state.textContent = t.inReview ? 'With the Owner for review' : '';
    body.append(state);
  } else if (t.downvoted) {
    const state = document.createElement('div');
    state.className = 'state';
    state.textContent = 'You Downvoted this';
    body.append(state, action('withdraw'));
    if (untried) body.append(tryNote());
  } else {
    body.append(action('downvote'));
    if (untried) body.append(tryNote());
  }
  li.append(img, body);
  return li;
}

let pending = 0;
async function load(q) {
  const ticket = ++pending;
  try {
    const { titles } = await api(`/api/titles?q=${encodeURIComponent(q)}`);
    if (ticket !== pending) return; // a newer search is on its way
    $('titles').replaceChildren(...titles.map(card));
    $('empty').hidden = titles.length > 0;
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
  $('who').textContent = me.username;
  $('logout').hidden = false;
  $('owner-link').hidden = !me.isOwner;
  $('owner-note').hidden = !me.isOwner;
  $('app').hidden = false;
  let timer;
  $('search').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => load(/** @type {HTMLInputElement} */ (e.target).value), 200);
  });
  load('');
}

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' }).catch(() => {});
  location.href = '/';
});

start();
