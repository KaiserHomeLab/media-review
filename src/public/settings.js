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

// ------------------------------------------------------------------ apps: tiles, + Add app, and the form
// Like Media Ops: a tile per app, a picker to add one, and a form for each in a dialog.
const GROUPS = [
  ['Play history', ['tautulli']],
  ['Deleting what you Remove', ['radarr', 'sonarr', 'sonarrAnime']],
  ['Holding back what was deleted', ['seerr']],
];
const ICON = { plex: 'PX', tautulli: 'TA', radarr: 'RA', sonarr: 'SO', sonarrAnime: 'SA', seerr: 'SE' };
let S = { plex: null, apps: [] };
/** @type {Record<string, { up: boolean, text: string }>} */
const appStatus = {};

const modal = /** @type {HTMLDialogElement} */ ($('modal'));
$('modal-close').addEventListener('click', () => modal.close());
modal.addEventListener('click', e => e.target === modal && modal.close());
/** @param {string} title @param {Node[]} body */
function openModal(title, body) {
  $('modal-title').textContent = title;
  $('modal-body').replaceChildren(...body);
  if (!modal.open) modal.showModal();
}

const icon = id => el('span', `app-icon k-${id}`, ICON[id] ?? '?');

function tile(id, name, kind, url) {
  const b = el('button', 'app-card');
  b.type = 'button';
  const st = appStatus[id];
  const nameRow = el('span', 'app-name', name);
  if (st) nameRow.append(Object.assign(el('span', `dot ${st.up ? 'up' : 'down'}`), { title: st.text }));
  b.append(icon(id), nameRow, el('span', 'app-kind', kind), el('span', 'app-url', url));
  if (st && !st.up) b.append(el('span', 'app-err', `✕ ${st.text}`));
  b.addEventListener('click', () =>
    id === 'plex'
      ? plexForm()
      : appForm(
          S.apps.find(a => a.id === id),
          true,
        ),
  );
  return b;
}

function renderApps() {
  const added = S.apps.filter(a => a.url);
  $('apps-count').textContent = `${added.length + (S.plex ? 1 : 0)} connected`;
  const tiles = [];
  if (S.plex) tiles.push(tile('plex', 'Plex', S.plex.name, S.plex.url));
  for (const a of added) tiles.push(tile(a.id, a.label, a.needed.split('.')[0], a.url));
  if (added.length < S.apps.length) {
    const add = el('button', 'app-card add');
    add.type = 'button';
    add.append(el('span', 'plus', '+'), el('span', '', 'Add app'));
    add.addEventListener('click', openPicker);
    tiles.push(add);
  }
  $('apps').replaceChildren(...tiles);
}

// Check every added app once, quietly, so each tile shows a green or red dot.
async function checkAll() {
  await Promise.all(
    S.apps
      .filter(a => a.url)
      .map(async a => {
        try {
          const { version } = await api(`/api/owner/settings/apps/${a.id}/test`, 'POST', { url: a.url, apiKey: '' });
          appStatus[a.id] = { up: true, text: `Connected${version ? `: ${version}` : ''}` };
        } catch (e) {
          appStatus[a.id] = { up: false, text: e.message };
        }
      }),
  );
  renderApps();
}

function openPicker() {
  const body = [];
  for (const [group, ids] of GROUPS) {
    const todo = S.apps.filter(a => ids.includes(a.id) && !a.url);
    if (!todo.length) continue;
    body.push(el('h3', 'pick-group', group));
    const grid = el('div', 'pick-grid');
    for (const a of todo) {
      const b = el('button', 'pick');
      b.type = 'button';
      b.append(icon(a.id), document.createTextNode(a.label));
      b.addEventListener('click', () => appForm(a, false));
      grid.append(b);
    }
    body.push(grid);
  }
  openModal('Add app', body);
}

/** @param {string} label @param {HTMLElement} input @param {string} [help] */
function field(label, input, help) {
  const f = el('label', 'field');
  f.append(el('span', '', label), input);
  if (help) f.append(el('small', '', help));
  return f;
}

// The form for one app: what it's for, address and API key, then Back or Delete, Test and Save.
function appForm(a, editing) {
  const url = Object.assign(el('input', ''), {
    value: a.url,
    placeholder: `http://${a.id === 'sonarrAnime' ? 'sonarr-anime' : a.id}:${a.port}`,
    spellcheck: false,
  });
  const key = Object.assign(el('input', ''), {
    type: 'password',
    autocomplete: 'off',
    placeholder: a.hasKey ? '•••••••••••• saved: leave blank to keep' : '',
  });
  const result = el('span', 'result');
  const body = () => ({ url: url.value, apiKey: key.value });
  const path = `/api/owner/settings/apps/${a.id}`;
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
  const actions = el('div', 'actions');
  actions.append(
    editing
      ? button('Delete', 'btn ghost danger', async () => {
          if (!confirm(`Remove ${a.label} from Media Review? Its address and key are forgotten.`)) return;
          await api(path, 'DELETE', {});
          delete appStatus[a.id];
          modal.close();
          load();
        })
      : button('← Back', 'btn ghost', async () => openPicker()),
    el('span', 'spacer'),
    result,
    button('Test', 'btn', async () => {
      const { version } = await api(`${path}/test`, 'POST', body());
      say(result, `Works${version ? `: ${a.label} ${version}` : ''}`, true);
    }),
    button('Save', 'btn primary', async () => {
      await api(path, 'PUT', body());
      modal.close();
      await load();
      checkAll();
    }),
  );
  const form = el('div', 'form');
  form.append(el('p', 'muted', a.needed), field('Address', url), field('API key', key, a.keyHelp), actions);
  openModal(editing ? a.label : `Add ${a.label}`, [form]);
  url.focus();
}

// Plex was linked at setup: only its address can change, and it must still be the same server.
function plexForm() {
  const url = Object.assign(el('input', ''), { value: S.plex.url, spellcheck: false });
  const result = el('span', 'result');
  const save = el('button', 'btn primary', 'Save');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await api('/api/owner/settings/plex', 'PUT', { url: url.value });
      modal.close();
      load();
    } catch (e) {
      say(result, e.message, false);
    }
    save.disabled = false;
  });
  const actions = el('div', 'actions');
  actions.append(el('span', 'spacer'), result, save);
  const form = el('div', 'form');
  form.append(
    el('p', 'muted', `Your server, ${S.plex.name}, linked at first setup.`),
    field('Address', url, 'How Media Review reaches it, e.g. http://plex:32400. It must be the same server.'),
    actions,
  );
  openModal('Plex', [form]);
}

// ------------------------------------------------------------------ rules
let animeKeys = [];
function showRules(r, libraries) {
  for (const input of document.querySelectorAll('[data-rule]')) input.value = String(r[input.dataset.rule] ?? '');
  animeKeys = [...r.animeLibraries];
  $('anime-libraries').replaceChildren(
    ...libraries.map(l => {
      const box = Object.assign(el('input', ''), { type: 'checkbox', checked: animeKeys.includes(l.key) });
      box.addEventListener('change', () => {
        animeKeys = box.checked ? [...animeKeys, l.key] : animeKeys.filter(k => k !== l.key);
      });
      const label = el('label', 'check');
      label.append(box, document.createTextNode(` ${l.name}`));
      return label;
    }),
  );
  if (!libraries.length)
    $('anime-libraries').textContent = 'No show libraries yet: they appear after the first sync with Plex.';
}

async function loadRules() {
  const { rules, showLibraries } = await api('/api/owner/rules');
  showRules(rules, showLibraries);
  $('rules-card').hidden = false;
  return showLibraries;
}

$('rules-save').addEventListener('click', async () => {
  for (const em of document.querySelectorAll('#rules-card em')) em.textContent = '';
  const body = { animeLibraries: animeKeys };
  for (const input of document.querySelectorAll('[data-rule]')) body[input.dataset.rule] = input.value;
  const res = await fetch('/api/owner/rules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (!res.ok) {
    // Each wrong value gets its reason next to it.
    for (const [key, why] of Object.entries(out.errors ?? {})) {
      const input = document.querySelector(`[data-rule="${key}"], [data-error-key="${key}"]`);
      const em = input?.parentElement?.querySelector('em') ?? document.querySelector(`[data-error="${key}"]`);
      if (em) em.textContent = `Should be ${why}.`;
    }
    say($('rules-result'), out.errors ? 'Not saved: see the fields marked above' : out.error, false);
    return;
  }
  say(
    $('rules-result'),
    out.queued ? `Saved. ${out.queued} Title${out.queued === 1 ? '' : 's'} reached the Review Queue.` : 'Saved',
    true,
  );
});

async function load() {
  const s = await api('/api/owner/settings');
  S = s;
  /** @type {HTMLInputElement} */ ($('public-url')).value = s.publicUrl;
  renderApps();
  for (const id of ['apps-card', 'public-card', 'key-card']) $(id).hidden = false;
}

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
Promise.all([
  load().then(checkAll),
  loadRules(),
  api('/api/owner/api-key').then(({ apiKey }) => showKey(apiKey)),
]).catch(e => fail(e.message === 'sign in first' ? 'Sign in as the Owner first.' : e.message));
