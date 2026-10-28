// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// The Owner's Settings: Plex, Tautulli, Radarr and Sonarrs, the public address, and the optional key for
// Media Ops. Saved API keys never come back to the browser: a saved one shows as "saved", and leaving
// the field blank keeps it.
'use strict';

const $ = id => /** @type {HTMLElement} */ (document.getElementById(id));
const el = (tag, cls, text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
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

/** @param {HTMLElement} where @param {string} text @param {boolean} ok */
function say(where, text, ok) {
  where.textContent = text;
  where.className = `result ${ok ? 'good' : 'bad'}`;
}

// One card per app: address, API key, Test, Save, Remove.
function appCard(a) {
  const card = el('section', 'card form');
  const head = el('h2', '', a.label);
  head.append(el('span', 'count', a.url ? 'set up' : 'not set up'));
  card.append(head, el('p', 'muted', a.needed));

  const url = Object.assign(el('input', ''), {
    value: a.url,
    placeholder: `http://${a.id === 'sonarrAnime' ? 'sonarr-anime' : a.id}:${a.port}`,
    spellcheck: false,
  });
  const key = Object.assign(el('input', ''), {
    type: 'password',
    autocomplete: 'off',
    placeholder: a.hasKey ? 'saved: leave blank to keep it' : '',
  });
  const field = (label, input, help) => {
    const f = el('label', 'field');
    f.append(el('span', '', label), input);
    if (help) f.append(el('small', '', help));
    return f;
  };
  card.append(field('Address', url), field('API key', key, a.keyHelp));

  const result = el('span', 'result');
  const button = (label, cls, fn) => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true;
      result.textContent = '';
      try {
        await fn();
      } catch (e) {
        say(result, e.message, false);
      }
      b.disabled = false;
    });
    return b;
  };
  const body = () => ({ url: url.value, apiKey: key.value });
  const path = `/api/owner/settings/apps/${a.id}`;
  const row = el('div', 'row');
  row.append(
    button('Test', 'btn', async () => {
      const { version } = await api(`${path}/test`, 'POST', body());
      say(result, `Works${version ? `: ${a.label} ${version}` : ''}`, true);
    }),
    button('Save', 'btn primary', async () => {
      await api(path, 'PUT', body());
      say(result, 'Saved', true);
      load();
    }),
  );
  if (a.url)
    row.append(
      button('Remove', 'btn ghost danger', async () => {
        if (!confirm(`Remove ${a.label} from Media Review? Its address and key are forgotten.`)) return;
        await api(path, 'DELETE', {});
        load();
      }),
    );
  row.append(result);
  card.append(row);
  return card;
}

async function load() {
  const s = await api('/api/owner/settings');
  $('plex-name').textContent = s.plex?.name ?? '';
  /** @type {HTMLInputElement} */ ($('plex-url')).value = s.plex?.url ?? '';
  /** @type {HTMLInputElement} */ ($('public-url')).value = s.publicUrl;
  $('apps').replaceChildren(...s.apps.map(appCard));
  for (const id of ['plex-card', 'public-card', 'key-card']) $(id).hidden = false;
}

$('plex-save').addEventListener('click', async () => {
  try {
    await api('/api/owner/settings/plex', 'PUT', { url: /** @type {HTMLInputElement} */ ($('plex-url')).value });
    say($('plex-result'), 'Saved', true);
  } catch (e) {
    say($('plex-result'), e.message, false);
  }
});

$('public-save').addEventListener('click', async () => {
  try {
    const { publicUrl } = await api('/api/owner/settings/public-url', 'PUT', {
      publicUrl: /** @type {HTMLInputElement} */ ($('public-url')).value,
    });
    say($('public-result'), publicUrl ? 'Saved' : 'Cleared', true);
  } catch (e) {
    say($('public-result'), e.message, false);
  }
});

// ------------------------------------------------------------------ the API key for Media Ops
const showKey = k => {
  $('key').textContent = k ?? 'No key yet. Generate one to connect Media Ops.';
  $('generate').textContent = k ? 'Generate a new key' : 'Generate a key';
};
$('generate').addEventListener('click', async () => {
  if (
    !$('key').textContent.startsWith('No key') &&
    !confirm('Replace the current key? Media Ops will need the new one.')
  )
    return;
  try {
    showKey((await api('/api/owner/api-key', 'POST', {})).apiKey);
  } catch (e) {
    fail(e.message);
  }
});

if (new URLSearchParams(location.search).get('welcome')) $('welcome').hidden = false;
Promise.all([load(), api('/api/owner/api-key').then(({ apiKey }) => showKey(apiKey))]).catch(e =>
  fail(e.message === 'sign in first' ? 'Sign in as the Owner first.' : e.message),
);
