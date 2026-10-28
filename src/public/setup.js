// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// First setup: the code from the log, Plex sign-in as the server's owner, then which server and how
// to reach it. Each step is checked by the server; this page just shows where you are.
'use strict';

const $ = id => /** @type {HTMLElement} */ (document.getElementById(id));
const el = (tag, cls, text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });

const SIGNIN = {
  failed: 'Plex sign-in did not finish. Try again.',
  'no-server': "That Plex account doesn't own a Plex server. Sign in with the account that does.",
};

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out?.error ?? `HTTP ${res.status}`);
  return out;
}

function fail(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

function show(step) {
  for (const s of ['code', 'signin', 'server']) $(`step-${s}`).hidden = s !== step;
}

let servers = [];
function pickServer() {
  const s = servers.find(x => x.machineId === /** @type {HTMLSelectElement} */ ($('server')).value);
  const known = s?.addresses ?? [];
  $('known').replaceChildren(
    ...known.flatMap((a, i) => {
      const b = el('button', 'linkish', a.url);
      b.type = 'button';
      b.addEventListener('click', () => /** @type {HTMLInputElement} */ ($('address').value = a.url));
      return i ? [document.createTextNode(', '), b] : [b];
    }),
  );
  if (!known.length) $('known').textContent = 'none';
}

async function start() {
  const err = new URLSearchParams(location.search).get('signin');
  if (err) {
    history.replaceState(null, '', '/setup.html');
    fail(SIGNIN[err] ?? 'Sign-in failed.');
  }
  const { setUp, step } = await api('/api/setup');
  if (setUp) return location.replace('/settings.html');
  show(step);
  if (step === 'server') {
    ({ servers } = await api('/api/setup/servers'));
    $('server').replaceChildren(
      ...servers.map(s => Object.assign(document.createElement('option'), { value: s.machineId, textContent: s.name })),
    );
    $('server').addEventListener('change', pickServer);
    pickServer();
  }
}

$('send-code').addEventListener('click', async () => {
  fail('');
  try {
    await api('/api/setup/code', { code: /** @type {HTMLInputElement} */ ($('code')).value });
    show('signin');
  } catch (e) {
    fail(e.message === 'wrong code' ? "That code isn't right. Check the log for the latest one." : e.message);
  }
});
$('code').addEventListener('keydown', e => e.key === 'Enter' && $('send-code').click());

$('link').addEventListener('click', async () => {
  fail('');
  const b = /** @type {HTMLButtonElement} */ ($('link'));
  b.disabled = true;
  try {
    await api('/api/setup/plex', {
      machineId: /** @type {HTMLSelectElement} */ ($('server')).value,
      url: /** @type {HTMLInputElement} */ ($('address')).value,
    });
    location.replace('/settings.html?welcome=1');
  } catch (e) {
    fail(e.message);
    b.disabled = false;
  }
});

start().catch(e => fail(e.message));
