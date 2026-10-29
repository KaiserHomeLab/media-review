// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Connect the Discord account the bot's link was made for to the Plex account signed in here. Not signed in:
// sign in with Plex first; the link is kept in this tab, and the Library page sends you back here after.
'use strict';

const $ = id => /** @type {HTMLElement} */ (document.getElementById(id));
const KEY = 'media-review:discord-link';

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' } });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body?.error ?? `HTTP ${res.status}`), { status: res.status });
  return body;
}

function fail(msg) {
  $('error').textContent = msg;
  $('error').hidden = false;
}

async function start() {
  let token = new URLSearchParams(location.search).get('t');
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else token = sessionStorage.getItem(KEY);
  } catch {}
  if (!token) {
    $('text').textContent = 'This page needs the link from the bot. In Discord, use /link for a new one.';
    $('home').hidden = false;
    return;
  }
  let me;
  try {
    me = await api('/api/me');
  } catch {
    $('text').textContent = 'Sign in with Plex first, with the account you watch on. You come back here after.';
    $('signin').hidden = false;
    return;
  }
  let link;
  try {
    link = await api(`/api/discord/link/${encodeURIComponent(token)}`);
  } catch (e) {
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
    $('text').textContent = '';
    fail(e.message);
    $('home').hidden = false;
    return;
  }
  $('text').textContent =
    `Connect the Discord account ${link.discordName ?? ''} to ${me.username} on Plex? Then the bot's commands work as you, under the same rules as here.`;
  $('connect').hidden = false;
  $('connect').addEventListener('click', async () => {
    /** @type {HTMLButtonElement} */ ($('connect')).disabled = true;
    try {
      await api(`/api/discord/link/${encodeURIComponent(token)}`, { method: 'POST', body: '{}' });
      try {
        sessionStorage.removeItem(KEY);
      } catch {}
      $('text').textContent = 'Connected. Go back to Discord and use the command again.';
      $('connect').hidden = true;
      $('home').hidden = false;
    } catch (e) {
      fail(e.message);
      /** @type {HTMLButtonElement} */ ($('connect')).disabled = false;
    }
  });
}

start();
