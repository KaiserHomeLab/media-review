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
const ICON = { plex: 'PX', tautulli: 'TA', radarr: 'RA', sonarr: 'SO', sonarrAnime: 'SA', seerr: 'SE', discord: 'DC' };
let S = { plex: null, apps: [], discord: null };
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
      : id === 'discord'
        ? discordForm(true)
        : appForm(
            S.apps.find(a => a.id === id),
            true,
          ),
  );
  return b;
}

function renderApps() {
  const added = S.apps.filter(a => a.url);
  $('apps-count').textContent = `${added.length + (S.plex ? 1 : 0) + (S.discord ? 1 : 0)} connected`;
  const tiles = [];
  if (S.plex) tiles.push(tile('plex', 'Plex', S.plex.name, S.plex.url));
  for (const a of added) tiles.push(tile(a.id, a.label, a.needed.split('.')[0], a.url));
  if (S.discord) {
    const st = S.discord.status;
    appStatus.discord = !st?.connected
      ? { up: false, text: st?.error ?? 'Connecting…' }
      : st.postError
        ? { up: false, text: `Couldn't post: ${st.postError}` }
        : { up: true, text: 'Connected' };
    tiles.push(tile('discord', 'Discord', `Bot in ${S.discord.guildName}`, `@${S.discord.botName}`));
  } else delete appStatus.discord;
  if (added.length < S.apps.length || !S.discord) {
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
  if (!S.discord) {
    body.push(el('h3', 'pick-group', 'Friends use it from Discord'));
    const grid = el('div', 'pick-grid');
    const b = el('button', 'pick');
    b.type = 'button';
    b.append(icon('discord'), document.createTextNode('Discord'));
    b.addEventListener('click', () => discordForm(false));
    grid.append(b);
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

// Discord: your own bot, made in Discord's Developer Portal. Paste its token, Test lists the servers it's in,
// pick yours, Save. The token never comes back to the browser.
function discordForm(editing) {
  const token = Object.assign(el('input', ''), {
    type: 'password',
    autocomplete: 'off',
    placeholder: editing ? '•••••••••••• saved: leave blank to keep' : '',
  });
  const guild = /** @type {HTMLSelectElement} */ (el('select', ''));
  const guildField = field('Server', guild, 'Commands work in this server only.');
  guildField.hidden = true;
  // Where the bot posts: announcements everyone sees, and messages only for you. Either can be left off.
  const announce = /** @type {HTMLSelectElement} */ (el('select', ''));
  const owner = /** @type {HTMLSelectElement} */ (el('select', ''));
  const channelFields = el('div', 'parts');
  channelFields.append(
    field(
      'Announcements',
      announce,
      'Leaving Soon, last day, staying, brought back, fixed problems. Never names anyone.',
    ),
    field('Your channel', owner, 'Review Queue, send-backs, reports, asks, failures. Make it one only you can see.'),
  );
  channelFields.hidden = true;
  /** @param {any} r what Test answered: the channels of r.guildId */
  const showChannels = r => {
    for (const [select, current] of [
      [announce, r.announceChannel],
      [owner, r.ownerChannel],
    ]) {
      select.replaceChildren(
        Object.assign(document.createElement('option'), { value: '', textContent: '— off —' }),
        ...r.channels.map(c =>
          Object.assign(document.createElement('option'), { value: c.id, textContent: `#${c.name}` }),
        ),
      );
      select.value = r.guildId === S.discord?.guildId ? current : '';
    }
    channelFields.hidden = false;
  };
  guild.addEventListener('change', () =>
    api('/api/owner/settings/discord/test', 'POST', { token: token.value, guildId: guild.value })
      .then(showChannels)
      .catch(e => say(result, e.message, false)),
  );
  const result = el('span', 'result');
  const steps = el('ol', 'steps');
  for (const s of [
    'Open discord.com/developers/applications and press New Application. Name it, e.g. Media Review.',
    'Bot → Reset Token, and copy the token. No privileged intents are needed.',
    'OAuth2 → URL Generator: tick bot and applications.commands, and under Bot Permissions tick Send Messages and Embed Links. Open the link it makes and add the bot to your server.',
    'Paste the token here, press Test, pick the server and the two channels, and Save.',
  ])
    steps.append(el('li', '', s));
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
  const test = async () => {
    const r = await api('/api/owner/settings/discord/test', 'POST', { token: token.value });
    const { bot, guilds } = r;
    if (!guilds.length)
      return say(result, `${bot} works, but isn't in any server yet: add it to yours (step 3).`, false);
    guild.replaceChildren(
      ...guilds.map(g => Object.assign(document.createElement('option'), { value: g.id, textContent: g.name })),
    );
    guild.value = r.guildId;
    guildField.hidden = false;
    showChannels(r);
    say(result, `Works: ${bot}`, true);
  };
  const actions = el('div', 'actions');
  actions.append(
    editing
      ? button('Delete', 'btn ghost danger', async () => {
          if (!confirm('Remove the Discord bot? It disconnects, and friends can no longer use its commands.')) return;
          await api('/api/owner/settings/discord', 'DELETE', {});
          modal.close();
          load();
        })
      : button('← Back', 'btn ghost', async () => openPicker()),
    el('span', 'spacer'),
    result,
    button('Test', 'btn', test),
    button('Save', 'btn primary', async () => {
      if (guildField.hidden) await test();
      if (guildField.hidden) return;
      await api('/api/owner/settings/discord', 'PUT', {
        token: token.value,
        guildId: guild.value,
        announceChannel: announce.value,
        ownerChannel: owner.value,
      });
      modal.close();
      await load();
      // It takes a moment to connect: look again shortly.
      setTimeout(() => load().catch(() => {}), 4000);
    }),
  );
  const form = el('div', 'form');
  form.append(
    el(
      'p',
      'muted',
      'Friends Downvote, withdraw, object and report from Discord with slash commands. Replies are private to them.',
    ),
    ...(editing ? [] : [steps]),
    field('Bot token', token, editing ? `@${S.discord.botName} in ${S.discord.guildName}` : undefined),
    guildField,
    channelFields,
    actions,
  );
  openModal(editing ? 'Discord' : 'Add Discord', [form]);
  if (editing) test().catch(e => say(result, e.message, false));
  token.focus();
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

// ------------------------------------------------------------------ appearance
// As in Media Ops: theme, accent, title and logo. The page shows a change straight away; Save keeps it.
let look = null;
const root = document.documentElement;
/** @param {{ theme: string, accent: string }} a */
function preview(a) {
  if (a.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = a.theme;
  if (a.accent === 'amber') delete root.dataset.accent;
  else root.dataset.accent = a.accent;
}
const chosen = () => ({
  theme:
    /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="theme"]:checked'))?.value ?? 'auto',
  accent:
    /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="accent"]:checked'))?.value ?? 'amber',
});
function showLook() {
  for (const r of document.querySelectorAll('input[name="theme"]')) r.checked = r.value === look.theme;
  $('accent-swatches').replaceChildren(
    ...look.accents.map(x => {
      const label = el('label', 'swatch');
      label.title = x.label;
      const input = Object.assign(el('input', ''), {
        type: 'radio',
        name: 'accent',
        value: x.id,
        checked: x.id === look.accent,
      });
      const dot = el('i', '');
      dot.setAttribute('aria-hidden', 'true');
      // The page's CSP allows no style="" attributes; setting them from script is fine.
      dot.style.setProperty('--sw-dark', x.dark);
      dot.style.setProperty('--sw-light', x.light);
      label.append(input, dot, el('span', '', x.label));
      return label;
    }),
  );
  /** @type {HTMLInputElement} */ ($('look-title')).value = look.title;
  const logo = look.logo;
  $('logo-preview').replaceChildren(
    ...(logo ? [Object.assign(el('img', ''), { src: `/branding/logo?v=${logo.hash}`, alt: 'Current logo' })] : []),
  );
  $('logo-remove').hidden = !logo;
  // The top bar here shows it too.
  const head = document.querySelector('header.top .logo');
  if (head) {
    const next = logo
      ? Object.assign(el('img', 'logo custom'), { src: `/branding/logo?v=${logo.hash}`, alt: '' })
      : el('span', 'logo');
    if (!logo) next.setAttribute('aria-hidden', 'true');
    head.replaceWith(next);
  }
  preview(look);
}
async function loadLook() {
  look = await api('/api/owner/appearance');
  showLook();
  $('appearance-card').hidden = false;
}
$('appearance-card').addEventListener('change', e => {
  if (
    /** @type {HTMLInputElement} */ (e.target).name === 'theme' ||
    /** @type {HTMLInputElement} */ (e.target).name === 'accent'
  )
    preview(chosen());
});
$('look-save').addEventListener('click', async () => {
  try {
    look = await api('/api/owner/appearance', 'PUT', {
      ...chosen(),
      title: /** @type {HTMLInputElement} */ ($('look-title')).value,
    });
    showLook();
    const h1 = document.querySelector('header.top h1');
    if (h1) h1.textContent = look.title || 'Media Review';
    say($('look-result'), 'Saved', true);
  } catch (e) {
    say($('look-result'), e.message, false);
  }
});
$('logo-file').addEventListener('change', async e => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 256 * 1024) return say($('look-result'), 'The logo must be 256 KB or smaller', false);
  const data = await new Promise((ok, refuse) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] ?? '');
    r.onerror = () => refuse(new Error("Couldn't read that file"));
    r.readAsDataURL(file);
  });
  try {
    look = await api('/api/owner/appearance/logo', 'POST', { data });
    showLook();
    say($('look-result'), 'Logo saved', true);
  } catch (err) {
    say($('look-result'), err.message, false);
  }
});
$('logo-remove').addEventListener('click', async () => {
  try {
    look = await api('/api/owner/appearance/logo', 'DELETE', {});
    showLook();
    say($('look-result'), 'Logo removed', true);
  } catch (err) {
    say($('look-result'), err.message, false);
  }
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
  loadLook(),
  loadRules(),
  api('/api/owner/api-key').then(({ apiKey }) => showKey(apiKey)),
]).catch(e => fail(e.message === 'sign in first' ? 'Sign in as the Owner first.' : e.message));
