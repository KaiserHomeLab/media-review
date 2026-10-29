// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// The Voter's page: browse Titles, cast Downvotes and file Problem Reports. A Voter only ever sees their own.
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
  downvoted: "You Downvoted this, so you can't also object to it going.",
  'objections-closed': 'This was sent back once already, so it takes no Objections this time.',
  'already-objected': 'You already objected to this.',
  'not-leaving': 'This is no longer Leaving Soon.',
  'pick-a-reason': "Pick what's wrong.",
  'say-what': 'Say what the problem is.',
  'unknown-part': "That season or episode isn't in Plex.",
  'already-reported': "You've already reported this problem.",
  'not-open': 'The Owner has already dealt with that report.',
  'not-reported': "You weren't on that report.",
  'already-asked': 'You already asked for this back.',
  'not-gone': 'This is no longer held back.',
  'not-asked': "You hadn't asked for this.",
};

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const body = res.status === 204 ? null : await res.json();
  if (!res.ok) throw Object.assign(new Error(body?.error ?? `HTTP ${res.status}`), { status: res.status });
  return body;
}

function showError(msg) {
  $('error').className = 'notice error';
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

// A plain message in the same place, e.g. after a send-back.
function showNotice(msg) {
  showError(msg);
  $('error').className = 'notice';
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
  const tryNote = () => el('div', 'note', `Counts once you've watched ${t.sampleMinutes} minutes of it.`);

  // Downvote, or Withdraw it again, until the Title is with the Owner.
  const action = (/** @type {'downvote' | 'withdraw'} */ what) => {
    const btn = el(
      'button',
      what === 'downvote' ? 'btn small' : 'btn small ghost',
      what === 'downvote' ? (me.egg?.founder ? '▼ Downvote (the original)' : '▼ Downvote') : 'Withdraw',
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

  // Object to it going, or take that back, while it's Leaving Soon.
  const objection = (/** @type {'object' | 'unobject'} */ what) => {
    const btn = el(
      'button',
      what === 'object' ? 'btn small' : 'btn small ghost',
      what === 'object' ? '▲ Object: keep it' : 'Withdraw Objection',
    );
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      showError('');
      try {
        const r = await api(`/api/titles/${encodeURIComponent(t.ratingKey)}/${what}`, { method: 'POST', body: '{}' });
        t.objected = what === 'object';
        if (r.sentBack) {
          // Enough Objections: it's back with the Owner, and no longer Leaving Soon.
          Object.assign(t, { leavingInDays: null, inReview: true, objected: false });
          showNotice('Sent back: the Owner will look at it again.');
        }
      } catch (e) {
        showError(ERRORS[e.message] ?? e.message);
        if (e.message === 'already-objected') t.objected = true;
        if (e.message === 'objections-closed') t.objectionsOpen = false;
      }
      li.replaceWith(card(t));
    });
    return btn;
  };

  const acts = el('div', 'acts');
  if (leaving && !me.isOwner) {
    // An Objection asks the Owner to look again; it weighs what this Voter's Downvote would.
    if (t.downvoted) acts.append(el('div', 'state', 'You Downvoted this'));
    else if (t.objected) acts.append(el('div', 'state', 'You objected to this'), objection('unobject'));
    else if (t.objectionsOpen)
      acts.append(objection('object'), el('div', 'note', 'Asks the Owner to look again before it goes.'));
    else acts.append(el('div', 'note', 'Sent back once already: no Objections this time.'));
  } else if (leaving) acts.append(el('div', 'state', 'Watch it before it goes'));
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
  // Anyone but the Owner can report a broken or poor copy, whatever else is going on with the Title.
  if (!me.isOwner) {
    const report = el('button', 'btn small ghost', '⚑ Report a problem');
    report.type = 'button';
    report.addEventListener('click', () => openReport(t).catch(e => showError(e.message)));
    acts.append(report);
  }
  body.append(acts);
  li.append(img, body);
  return li;
}

// ------------------------------------------------------------------ Problem Reports
const modal = /** @type {HTMLDialogElement} */ ($('modal'));
$('modal-close').addEventListener('click', () => modal.close());

const REASONS = [
  ['wont-play', "Won't play"],
  ['video', 'Video'],
  ['audio', 'Audio'],
  ['subtitles', 'Subtitles'],
  ['wrong', 'Wrong title or language'],
  ['quality', 'Poor quality'],
  ['other', 'Other'],
];
const OUTCOME = { resolved: 'Resolved', closed: 'Closed' };

/** @param {string} label @param {HTMLElement} input @param {string} [help] */
function field(label, input, help) {
  const f = el('label', 'field');
  f.append(el('span', '', label), input);
  if (help) f.append(el('small', '', help));
  return f;
}

const option = (/** @type {string} */ value, /** @type {string} */ text) =>
  Object.assign(document.createElement('option'), { value, textContent: text });
const seasonName = (/** @type {number} */ n) => (n === 0 ? 'Specials' : `Season ${n}`);

// The dialog for one Title: the open reports on it (say "me too", or take yours back), then a new one.
async function openReport(t) {
  const [{ problemReports: open }, { seasons }] = await Promise.all([
    api(`/api/titles/${encodeURIComponent(t.ratingKey)}/problems`),
    t.kind === 'show' ? api(`/api/titles/${encodeURIComponent(t.ratingKey)}/episodes`) : { seasons: [] },
  ]);
  const err = el('p', 'notice error');
  err.hidden = true;
  const fail = (/** @type {string} */ code) => {
    err.textContent = ERRORS[code] ?? code;
    err.hidden = false;
  };
  const done = (/** @type {string} */ msg) => {
    modal.close();
    showNotice(msg);
    loadReports();
  };
  const body = [];

  if (open.length) {
    const list = el('ul', 'open-reports');
    for (const r of open) {
      const li = el('li', '');
      const what = el('div', 'what');
      what.append(el('b', '', r.reasonLabel), el('div', 'muted', r.part ?? (t.kind === 'show' ? 'Whole show' : '')));
      const b = el('button', r.mine ? 'btn small ghost' : 'btn small', r.mine ? 'Withdraw' : 'Me too');
      b.type = 'button';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await api(`/api/problems/${r.id}/${r.mine ? 'withdraw' : 'me-too'}`, { method: 'POST', body: '{}' });
          done(r.mine ? 'Taken back.' : "Added you: you'll see here what the Owner does about it.");
        } catch (e) {
          fail(e.message);
          b.disabled = false;
        }
      });
      li.append(what);
      if (r.mine) li.append(el('span', 'chip review', 'You reported this'));
      li.append(b);
      list.append(li);
    }
    body.push(el('div', 'pick-group', 'Already reported'), list, el('div', 'pick-group', 'Something else'));
  }

  const form = el('div', 'report-form');
  // Which part: for a show, the whole show, a season, or one episode.
  const season = /** @type {HTMLSelectElement} */ (el('select', ''));
  const episode = /** @type {HTMLSelectElement} */ (el('select', ''));
  if (t.kind === 'show' && seasons.length) {
    season.append(option('', 'Whole show'), ...seasons.map(x => option(String(x.season), seasonName(x.season))));
    const fillEpisodes = () => {
      const s = seasons.find(x => String(x.season) === season.value);
      episode.replaceChildren(
        option('', s ? 'Every episode' : '—'),
        ...(s?.episodes ?? []).map(e => option(String(e.episode), `E${e.episode}${e.title ? ` · ${e.title}` : ''}`)),
      );
      episode.disabled = !s;
    };
    season.addEventListener('change', fillEpisodes);
    fillEpisodes();
    const parts = el('div', 'parts');
    parts.append(field('Season', season), field('Episode', episode));
    form.append(parts);
  }

  let reason = '';
  const reasons = el('div', 'pick-grid reasons');
  const note = /** @type {HTMLTextAreaElement} */ (el('textarea', ''));
  Object.assign(note, { maxLength: 500, rows: 3, placeholder: 'e.g. stops at 20 minutes, no sound after the intro' });
  const noteField = field('What happens?', note, 'Optional');
  for (const [id, label] of REASONS) {
    const b = el('button', 'pick', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      reason = id;
      for (const x of reasons.children) x.setAttribute('aria-pressed', String(x === b));
      /** @type {HTMLElement} */ (noteField.querySelector('small')).textContent =
        id === 'other' ? 'Needed for Other' : 'Optional';
    });
    reasons.append(b);
  }
  const reasonField = el('div', 'field');
  reasonField.append(el('span', '', "What's wrong?"), reasons);

  const send = el('button', 'btn primary', 'Send to the Owner');
  send.type = 'button';
  send.addEventListener('click', async () => {
    if (!reason) return fail('pick-a-reason');
    if (reason === 'other' && !note.value.trim()) return fail('say-what');
    send.disabled = true;
    try {
      const r = await api(`/api/titles/${encodeURIComponent(t.ratingKey)}/problems`, {
        method: 'POST',
        body: JSON.stringify({
          season: season.value || null,
          episode: episode.value || null,
          reason,
          note: note.value,
        }),
      });
      done(
        r.joined
          ? 'Someone already reported that: added you to it.'
          : "Sent. You'll see here when the Owner resolves or closes it.",
      );
    } catch (e) {
      fail(e.message);
      send.disabled = false;
    }
  });
  const actions = el('div', 'actions');
  actions.append(el('span', 'muted', 'This never counts as a Downvote.'), el('span', 'spacer'), send);
  form.append(reasonField, noteField, err, actions);
  body.push(form);

  $('modal-title').textContent = `Report a problem: ${t.title}`;
  $('modal-body').replaceChildren(...body);
  if (!modal.open) modal.showModal();
}

// ------------------------------------------------------------------ Gone: asking for it back
// A deleted Title can't be requested in Seerr any more; a friend asks the Owner here instead.
function goneCard(g) {
  const li = el('li', 'tile');
  const img = el(g.poster ? 'img' : 'div', 'poster');
  if (g.poster) Object.assign(img, { src: g.poster, alt: '', loading: 'lazy' });
  const body = el('div', 'body');
  const meta = el('div', 'meta');
  meta.append(el('span', 'chip', g.library ?? (g.kind === 'movie' ? 'Movie' : 'Show')));
  if (g.year) meta.append(el('span', 'chip', String(g.year)));
  meta.append(el('span', 'chip held', `↺ Deleted ${shortDate(g.deletedAt)}`));
  body.append(el('div', 'name', g.title), meta);
  const acts = el('div', 'acts');
  if (me.isOwner) acts.append(el('div', 'state', 'Bring it back from the Review Queue page'));
  else if (g.asked) {
    const w = el('button', 'btn small ghost', 'Withdraw');
    w.type = 'button';
    w.addEventListener('click', async () => {
      w.disabled = true;
      try {
        await api(`/api/gone/${encodeURIComponent(g.ratingKey)}/withdraw`, { method: 'POST', body: '{}' });
        g.asked = false;
      } catch (e) {
        showError(ERRORS[e.message] ?? e.message);
      }
      li.replaceWith(goneCard(g));
      loadAsks();
    });
    acts.append(el('div', 'state', 'You asked for it back'), w);
  } else {
    const b = el('button', 'btn small', '↺ Ask to bring it back');
    b.type = 'button';
    b.addEventListener('click', () => askForm(g, li));
    acts.append(b, el('div', 'note', "It can't be requested in Seerr: the Owner decides."));
  }
  body.append(acts);
  li.append(img, body);
  return li;
}

function askForm(g, li) {
  const note = /** @type {HTMLTextAreaElement} */ (el('textarea', ''));
  Object.assign(note, {
    maxLength: 500,
    rows: 3,
    placeholder: "e.g. I never got to finish it, or it's my kid's favourite",
  });
  const err = el('p', 'notice error');
  err.hidden = true;
  const send = el('button', 'btn primary', 'Ask the Owner');
  send.type = 'button';
  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      await api(`/api/gone/${encodeURIComponent(g.ratingKey)}/ask`, {
        method: 'POST',
        body: JSON.stringify({ note: note.value }),
      });
      g.asked = true;
      modal.close();
      li.replaceWith(goneCard(g));
      showNotice("Asked. You'll see here what the Owner decides.");
      loadAsks();
    } catch (e) {
      err.textContent = ERRORS[e.message] ?? e.message;
      err.hidden = false;
      send.disabled = false;
    }
  });
  const form = el('div', 'report-form');
  const actions = el('div', 'actions');
  actions.append(el('span', 'muted', 'The Owner sees why it was removed before deciding.'), el('span', 'spacer'), send);
  form.append(field('Why do you want it back?', note, 'Optional'), err, actions);
  $('modal-title').textContent = `Bring back ${g.title}?`;
  $('modal-body').replaceChildren(form);
  if (!modal.open) modal.showModal();
  note.focus();
}

const ASKED = { 'brought-back': 'Brought back', declined: 'Declined' };

// Clearing a finished report or answered ask from your own list. Nobody else's list changes.
/** @param {string} path @param {() => Promise<void>} reload */
function clearButton(path, reload) {
  const b = el('button', 'btn small ghost', 'Clear');
  b.type = 'button';
  b.title = 'Remove it from your list';
  b.addEventListener('click', async () => {
    b.disabled = true;
    await api(path, { method: 'POST', body: '{}' }).catch(e => showError(ERRORS[e.message] ?? e.message));
    reload();
  });
  return b;
}
/** @param {string} id @param {string} path @param {() => Promise<void>} reload */
function clearAll(id, path, reload) {
  $(id).onclick = async () => {
    await api(path, { method: 'POST', body: '{}' }).catch(e => showError(e.message));
    reload();
  };
}
clearAll('reports-clear', '/api/problems/dismiss-finished', () => loadReports());
clearAll('asks-clear', '/api/asks/dismiss-finished', () => loadAsks());

// What changed since the last look: a report or ask that has just been answered gets a notice. The first
// look only takes note, so opening the page doesn't announce old news.
const known = { reports: /** @type {Map<number, string | null> | null} */ (null), asks: null };
/** @param {'reports' | 'asks'} list @param {Array<{ id: number, outcome: string | null }>} items @param {(x: any) => string} say */
function news(list, items, say) {
  const before = known[list];
  known[list] = new Map(items.map(x => [x.id, x.outcome]));
  if (!before) return;
  const fresh = items.filter(x => x.outcome && before.has(x.id) && !before.get(x.id));
  if (fresh.length) showNotice(fresh.map(say).join(' '));
}

// The Voter's asks: open ones, and what the Owner decided on the rest (for 30 days).
async function loadAsks() {
  const { asks } = await api('/api/asks');
  news('asks', asks, a =>
    a.outcome === 'brought-back'
      ? `The Owner is bringing back ${a.title}.`
      : `The Owner declined bringing back ${a.title}${a.ownerNote ? `: ${a.ownerNote}` : '.'}`,
  );
  $('asks-clear').hidden = !asks.some(a => a.outcome);
  $('asks-card').hidden = !asks.length;
  const open = asks.filter(a => !a.outcome).length;
  $('asks-count').textContent = open ? `${open} waiting` : 'all answered';
  $('asks').replaceChildren(
    ...asks.map(a => {
      const li = el('li', 'entry text');
      const main = el('div', 'main');
      const head = el('div', 'head');
      head.append(el('b', '', a.title));
      if (a.year) head.append(el('span', 'muted', ` (${a.year})`));
      const chips = el('div', 'meta');
      chips.append(
        a.outcome
          ? el(
              'span',
              a.outcome === 'brought-back' ? 'chip good' : 'chip',
              `${ASKED[a.outcome]} ${shortDate(a.decidedAt)}`,
            )
          : el('span', 'chip kind', 'Waiting for the Owner'),
      );
      main.append(head, chips);
      if (a.outcome === 'brought-back')
        main.append(el('div', 'line', "It's been requested: it's back once it has downloaded."));
      if (a.ownerNote) main.append(el('div', 'line', `Owner: ${a.ownerNote}`));
      else if (a.note) main.append(el('div', 'line muted', `You said: ${a.note}`));
      li.append(main);
      if (a.outcome) {
        const acts = el('div', 'acts');
        acts.append(clearButton(`/api/asks/${a.id}/dismiss`, () => loadAsks()));
        li.append(acts);
      }
      return li;
    }),
  );
}

// ------------------------------------------------------------------ a thank-you
// For the friend who made us build this: a badge by their name, and once a year a welcome with confetti.
// Clicking the badge shows the welcome again.
/** @param {boolean} welcome */
function founder(welcome) {
  const badge = el('button', 'chip founder', '★ Inspired this app');
  badge.type = 'button';
  badge.title = 'Media Review exists because of you. Thank you.';
  // It sits inside the header's home link: show the welcome instead of going home.
  badge.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    welcomeBanner();
  });
  $('who').append(' ', badge);
  if (!welcome) return;
  welcomeBanner();
  api('/api/me/welcomed', { method: 'POST', body: '{}' }).catch(() => {});
}

const CONFETTI = ['#e5a00d', '#d95926', '#199e70', '#4a90e2', '#9b7fe6', '#f4f3ee'];
function welcomeBanner() {
  document.querySelector('.founder-welcome')?.remove();
  const box = el('div', 'founder-welcome');
  box.setAttribute('role', 'status');
  const close = el('button', 'icon-btn', '✕');
  Object.assign(close, { type: 'button', ariaLabel: 'Close' });
  close.addEventListener('click', () => box.remove());
  box.append(
    el('b', '', `This whole thing exists because of you, ${me.username}.`),
    el('span', '', 'Every Downvote, every Leaving Soon, all of it started with you. Thank you. ★'),
    close,
  );
  // With reduced motion the confetti stays put, sprinkled over the banner; otherwise it falls across the page.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rain = el('div', still ? 'confetti still' : 'confetti');
  rain.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < (still ? 28 : 90); i++) {
    const bit = el('i', '');
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = CONFETTI[i % CONFETTI.length];
    if (still) {
      bit.style.top = `${Math.random() * 100}%`;
      bit.style.transform = `rotate(${Math.round(Math.random() * 180)}deg)`;
    } else {
      bit.style.animationDelay = `${Math.random() * 0.8}s`;
      bit.style.animationDuration = `${2.4 + Math.random() * 1.8}s`;
      bit.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 180)}px`);
      bit.style.setProperty('--spin', `${Math.round((Math.random() - 0.5) * 1440)}deg`);
    }
    rain.append(bit);
  }
  if (still) box.append(rain);
  else {
    document.body.append(rain);
    setTimeout(() => rain.remove(), 5000);
  }
  document.querySelector('main')?.prepend(box);
}

// ------------------------------------------------------------------ quack
// Type "quack" in the search box: a rubber duck waddles across the bottom of the page. For our rubber duck.
const isQuack = (/** @type {string} */ q) => q.trim().toLowerCase() === 'quack';
const DUCK = `<svg viewBox="0 0 64 56" width="64" height="56" aria-hidden="true">
  <ellipse cx="30" cy="38" rx="22" ry="14" fill="#f5c518"/>
  <path d="M10 34 q-6 -10 4 -12 q2 6 -4 12z" fill="#f5c518"/>
  <circle cx="44" cy="20" r="11" fill="#f5c518"/>
  <path d="M53 19 l10 3 l-10 4 z" fill="#f08a1c"/>
  <circle cx="47" cy="17" r="2" fill="#1a1a19"/>
  <path d="M22 36 q8 8 18 0" fill="none" stroke="#d9a90f" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;
function duck() {
  if (document.querySelector('.duck')) return;
  const d = el('div', 'duck');
  d.setAttribute('role', 'status');
  const body = el('div', 'duck-body');
  body.innerHTML = DUCK;
  d.append(el('div', 'duck-say', 'Thanks, you know who you are!'), body);
  document.body.append(d);
  // It walks across in 7 seconds; with reduced motion it just sits in the corner for a moment.
  setTimeout(() => d.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 4000 : 7200);
}

// ------------------------------------------------------------------ Discord
// Whether this account's Discord is connected, and Disconnect. Connecting starts in Discord, with /link.
async function loadDiscord() {
  const d = await api('/api/discord');
  $('discord-line').hidden = !d.enabled;
  if (!d.enabled) return;
  const text = d.linked
    ? `Discord: connected as ${d.linked.name ?? 'you'}.`
    : `Discord: not connected. In ${d.guildName ?? 'the Discord server'}, use /link.`;
  const parts = [el('span', '', text)];
  if (d.linked) {
    const b = el('button', 'linkish', 'Disconnect');
    b.type = 'button';
    b.addEventListener('click', async () => {
      await api('/api/discord/unlink', { method: 'POST', body: '{}' }).catch(e => showError(e.message));
      loadDiscord();
    });
    parts.push(document.createTextNode(' '), b);
  }
  $('discord-line').replaceChildren(...parts);
}

/** @param {string} iso */
const shortDate = iso => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

// The Voter's own reports: open ones, and what the Owner did with the rest (for 30 days).
async function loadReports() {
  const { problemReports } = await api('/api/problems');
  news(
    'reports',
    problemReports,
    r =>
      `Your Problem Report on ${r.title.name ?? 'a title'} was ${r.outcome}${r.ownerNote ? `: ${r.ownerNote}` : '.'}`,
  );
  $('reports-clear').hidden = !problemReports.some(r => r.outcome);
  $('reports-card').hidden = !problemReports.length;
  const open = problemReports.filter(r => !r.outcome).length;
  $('reports-count').textContent = open ? `${open} open` : 'all dealt with';
  $('reports').replaceChildren(
    ...problemReports.map(r => {
      const li = el('li', 'entry text');
      const main = el('div', 'main');
      const head = el('div', 'head');
      head.append(el('b', '', r.title.name ?? 'A title no longer in the library'));
      const chips = el('div', 'meta');
      chips.append(el('span', 'chip', r.reasonLabel));
      if (r.part) chips.append(el('span', 'chip', r.part));
      chips.append(
        r.outcome
          ? el(
              'span',
              r.outcome === 'resolved' ? 'chip good' : 'chip',
              `${OUTCOME[r.outcome]} ${shortDate(r.decidedAt)}`,
            )
          : el('span', 'chip review', 'Waiting for the Owner'),
      );
      main.append(head, chips);
      if (r.ownerNote) main.append(el('div', 'line', `Owner: ${r.ownerNote}`));
      else if (r.note) main.append(el('div', 'line muted', `You said: ${r.note}`));
      li.append(main);
      if (!r.outcome) {
        const b = el('button', 'btn small ghost', 'Withdraw');
        b.type = 'button';
        b.addEventListener('click', async () => {
          b.disabled = true;
          await api(`/api/problems/${r.id}/withdraw`, { method: 'POST', body: '{}' }).catch(e =>
            showError(ERRORS[e.message] ?? e.message),
          );
          loadReports();
        });
        const acts = el('div', 'acts');
        acts.append(b);
        li.append(acts);
      } else {
        const acts = el('div', 'acts');
        acts.append(clearButton(`/api/problems/${r.id}/dismiss`, () => loadReports()));
        li.append(acts);
      }
      return li;
    }),
  );
}

// The library tab ('' is All), remembered in this browser only.
const TAB_KEY = 'media-review:library';
let library = '';
try {
  library = localStorage.getItem(TAB_KEY) ?? '';
} catch {}
let query = '';

// The Leaving Soon and Gone tabs; not Plex library names, which can't start with a NUL.
const LEAVING = '\u0000leaving';
const GONE = '\u0000gone';

// One tab per Plex library (Movies, TV Shows, Anime…), named as in Plex, then Leaving Soon when anything is.
async function loadTabs() {
  const [{ libraries }, { leavingSoon }, { gone }] = await Promise.all([
    api('/api/libraries'),
    api('/api/leaving-soon'),
    api('/api/gone'),
  ]);
  if (
    !libraries.some(l => l.name === library) &&
    !(library === LEAVING && leavingSoon.length) &&
    !(library === GONE && gone.length)
  )
    library = '';
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
  // Deleted, and held back from Seerr: friends can ask the Owner to bring it back.
  if (gone.length) {
    const g = tab(GONE, 'Gone', gone.length);
    g.classList.add('gone');
    tabs.push(g);
  }
  $('tabs').replaceChildren(...tabs);
  $('tabs').hidden = tabs.length < 3 && !leavingSoon.length && !gone.length;
}

let pending = 0;
async function load() {
  const ticket = ++pending;
  const q = query;
  try {
    if (library === GONE) {
      const { gone } = await api('/api/gone');
      if (ticket !== pending) return;
      const found = gone.filter(g => g.title.toLowerCase().includes(q.toLowerCase()));
      $('titles').replaceChildren(...found.map(goneCard));
      $('empty').hidden = found.length > 0;
      $('count').textContent = `${found.length} gone`;
      return;
    }
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
    // A fresh install: nobody can sign in until the Owner has done first setup.
    const setup = await api('/api/setup').catch(() => null);
    if (setup && !setup.setUp) return location.replace('/setup.html');
    $('signin').hidden = false;
    if (err) {
      $('signin-error').textContent = SIGNIN_ERRORS[err] ?? 'Sign-in failed.';
      $('signin-error').hidden = false;
    }
    return;
  }
  // Came here to connect Discord and had to sign in first: back to it.
  try {
    if (sessionStorage.getItem('media-review:discord-link')) return location.replace('/link.html');
  } catch {}
  $('who').textContent = me.isOwner ? `${me.username} · Owner` : me.username;
  if (me.egg?.founder) founder(me.egg.welcome);
  $('logout').hidden = false;
  $('owner-link').hidden = !me.isOwner;
  $('settings-link').hidden = !me.isOwner;
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
      const was = query;
      query = /** @type {HTMLInputElement} */ (e.target).value;
      if (isQuack(query) && !isQuack(was)) duck();
      load();
    }, 200);
  });
  if (!me.isOwner) {
    const mine = () => Promise.all([loadReports(), loadAsks()]).catch(() => {});
    mine();
    // Keep them current without a reload: every minute while the page is in view, and on coming back to it.
    setInterval(() => document.visibilityState === 'visible' && mine(), 60000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && mine());
  }
  loadDiscord().catch(() => {});
  await loadTabs().catch(e => showError(e.message));
  load();
}

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' }).catch(() => {});
  location.href = '/';
});

start();
