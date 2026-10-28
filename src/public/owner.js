// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// The Owner's page: the API key Media Ops connects with.
'use strict';

const $ = id => /** @type {HTMLElement} */ (document.getElementById(id));

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' } });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

function fail(msg) {
  $('error').textContent = msg;
  $('error').hidden = false;
}

const show = key => {
  $('key').textContent = key ?? 'No key yet. Generate one to connect Media Ops.';
  $('generate').textContent = key ? 'Generate a new key' : 'Generate a key';
};

$('generate').addEventListener('click', async () => {
  if (
    $('key').textContent &&
    !$('key').textContent.startsWith('No key') &&
    !confirm('Replace the current key? Media Ops will need the new one.')
  )
    return;
  try {
    show((await api('/api/owner/api-key', { method: 'POST', body: '{}' })).apiKey);
  } catch (e) {
    fail(e.message);
  }
});

api('/api/owner/api-key')
  .then(({ apiKey }) => {
    show(apiKey);
    $('panel').hidden = false;
  })
  .catch(e => fail(e.message === 'sign in first' ? 'Sign in as the Owner first.' : e.message));
