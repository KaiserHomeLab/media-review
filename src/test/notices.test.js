// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
process.env.TZ = 'Europe/Amsterdam';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { DEFAULTS } = require('../lib/rules');
const { castDownvote, keep, object } = require('../lib/review');
const P = require('../lib/problems');
const H = require('../lib/holdback');
const N = require('../lib/notices');

const NOW = 1_800_000_000;
const DAY = 86400;
const EPISODES = async () => [];

function setup() {
  const store = openStore(':memory:');
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie', year: 2020, library: 'Movies', thumb: '/t/m1' },
    { ratingKey: 'm2', kind: 'movie', title: 'Other Movie', library: 'Movies' },
    { ratingKey: 'm3', kind: 'movie', title: 'Third', tmdbId: '3' },
    { ratingKey: 's1', kind: 'show', title: 'Long Show', library: 'TV Shows' },
  ]);
  for (const [id, name] of [
    ['a', 'alice'],
    ['b', 'bob'],
    ['c', 'carol'],
  ])
    store.upsertVoter({ plexId: id, username: name });
  /** @param {Partial<Parameters<typeof N.collect>[0]>} [o] */
  const collect = (o = {}) =>
    N.collect({ store, now: NOW, since: NOW - DAY, announce: true, owner: true, publicUrl: 'https://r.example', ...o });
  /** @param {string} target */
  const notices = target =>
    store.db
      .prepare('SELECT key, message FROM notices WHERE target = ? ORDER BY id')
      .all(target)
      .map(r => ({ key: String(r.key), ...JSON.parse(String(r.message)) }));
  return { store, collect, notices };
}

test('each event is recorded exactly once, however often it runs; nothing from before the channels were set', async () => {
  const s = setup();
  s.store.remove('m1', NOW - 60, NOW + 14 * DAY);
  s.store.remove('m2', NOW - 2 * DAY, NOW + 12 * DAY); // Removed before announcements were on
  assert.equal(s.collect(), 1);
  assert.equal(s.collect(), 0);
  assert.equal(s.collect({ now: NOW + 3600 }), 0);
  const [a] = s.notices('announce');
  assert.equal(a.key, `leaving:m1:${NOW - 60}`);
  assert.equal(a.embeds[0].title, 'Leaving Soon: Dull Movie (2020) · Movies');
  assert.match(a.embeds[0].description, /^Leaves \w{3} \d+ \w{3}\. Watch it before then, or use \/object/);
  assert.match(a.embeds[0].thumbnail.url, /^https:\/\/r\.example\/cover\/m1\/[\w-]{22}$/);
  assert.ok(N.posterOk(s.store, 'm1', a.embeds[0].thumbnail.url.split('/').pop()));
  assert.ok(!N.posterOk(s.store, 'm2', a.embeds[0].thumbnail.url.split('/').pop()), 'one link per poster');
});

test('the day before it goes, a last-day reminder; not earlier', () => {
  const s = setup();
  s.store.remove('m1', NOW - 13 * DAY, NOW + DAY + 60);
  s.collect({ since: NOW - 14 * DAY });
  assert.ok(!s.notices('announce').some(n => n.key.startsWith('reminder:')));
  s.collect({ since: NOW - 14 * DAY, now: NOW + 120 });
  assert.deepEqual(
    s.notices('announce').map(n => n.key.split(':')[0]),
    ['leaving', 'reminder'],
  );
});

test('the Review Queue goes to the Owner with who Downvoted; announcements never name anyone', () => {
  const s = setup();
  for (const v of ['a', 'b', 'c'])
    s.store.upsertPlays([{ id: v, voterId: v, titleKey: 'm1', started: NOW - 10 * DAY, seconds: 7200, watched: true }]);
  for (const v of ['a', 'b']) castDownvote(s.store, DEFAULTS, v, 'm1', NOW - 60);
  assert.ok(s.store.isQueued('m1'));
  s.collect();
  const [o] = s.notices('owner');
  assert.match(
    o.content,
    /^▼ In the Review Queue: Dull Movie \(2020\)\. .* Downvoted by alice \(\d+\), bob \(\d+\)\.$/,
  );

  // Removed, then carol objects and sends it back.
  s.store.remove('m1', NOW - 30, NOW + 14 * DAY);
  s.collect(); // a minute later, before anyone objects
  const r = object(s.store, { ...DEFAULTS, objectionBar: 0.1 }, 'c', 'm1', NOW - 10);
  assert.ok(r.ok && r.sentBack);
  s.collect();
  assert.match(s.notices('owner').at(-1).content, /^▲ Sent back by Objections: Dull Movie \(2020\)\. carol asked/);
  assert.deepEqual(
    s.notices('announce').map(n => n.key.split(':')[0]),
    ['leaving', 'staying'],
  );
  const everything = JSON.stringify(s.notices('announce'));
  assert.doesNotMatch(everything, /alice|bob|carol/);
});

test('Kept after all and brought back are announced', async () => {
  const s = setup();
  s.store.remove('m1', NOW - 60, NOW + 14 * DAY);
  keep(s.store, 'm1', NOW - 30);
  s.store.remove('m3', NOW - 20 * DAY, NOW - 6 * DAY);
  s.store.deleted('m3', NOW - 6 * DAY, ['Radarr']);
  const seerr = /** @type {any} */ ({ unblock: async () => {}, request: async () => {} });
  await H.bringBack(s.store, seerr, 'm3', null, NOW - 5);
  s.collect();
  assert.deepEqual(
    s.notices('announce').map(n => n.embeds[0].title),
    ['Staying after all: Dull Movie (2020) · Movies', 'Coming back: Third'],
  );
});

test('Problem Reports: the Owner hears of a new one; a resolved one is announced; each linked reporter is told', async () => {
  const s = setup();
  s.store.link('d-alice', 'a', null, NOW - DAY * 9);
  const one = await P.report(s.store, 'a', { titleKey: 'm1', reason: 'audio', note: 'no sound' }, NOW - 60, EPISODES);
  const two = await P.report(s.store, 'b', { titleKey: 'm2', reason: 'video' }, NOW - 50, EPISODES);
  assert.ok(one.ok && two.ok);
  P.meToo(s.store, 'b', one.id, null, NOW - 40);
  s.collect();
  assert.deepEqual(
    s.notices('owner').map(n => n.content),
    [
      '⚑ Problem Report: Dull Movie (2020) (Audio), from alice: “no sound”.',
      '⚑ Problem Report: Other Movie (Video), from bob.',
    ],
    'one per report, not per me too',
  );
  P.decide(s.store, one.id, 'resolved', 'Replaced', NOW - 20);
  P.decide(s.store, two.id, 'closed', null, NOW - 10);
  s.collect();
  assert.deepEqual(
    s.notices('announce').map(n => n.embeds[0].title),
    ['Fixed: Dull Movie (2020) · Movies'],
    'closed ones are not announced',
  );
  assert.deepEqual(
    s.notices('dm:d-alice').map(n => n.content),
    ['✓ Resolved: your Problem Report on Dull Movie (2020) (Audio). The Owner says: Replaced'],
  );
  assert.equal(s.notices('dm:d-bob').length, 0, 'bob has no Discord linked');
});

test('asks to bring back, and a deletion that failed (once), go to the Owner', () => {
  const s = setup();
  s.store.remove('m3', NOW - 20 * DAY, NOW - 6 * DAY);
  s.store.deleted('m3', NOW - 6 * DAY, ['Radarr']);
  H.ask(s.store, 'a', 'm3', 'please', NOW - 60);
  s.store.remove('m1', NOW - 15 * DAY, NOW - 3600);
  s.store.deleteFailed('m1', 'not found in Radarr, so nothing was deleted', []);
  s.collect();
  s.store.deleteFailed('m1', 'Radarr answered HTTP 503', []); // the next night, another reason: still one message
  s.collect();
  assert.deepEqual(
    s.notices('owner').map(n => n.content),
    [
      "⚠ Couldn't delete Dull Movie (2020): not found in Radarr, so nothing was deleted. It stays Leaving Soon and is tried again tonight.",
      '↺ alice asked to bring back Third: “please”. Decide on the Review Queue page.',
    ],
  );
});

test('an app down for an hour is reported once, and again when it is back', () => {
  const s = setup();
  const h = N.health();
  h.fail('Seerr', 'Seerr answered HTTP 503', NOW - 1800);
  s.collect({ health: h });
  assert.equal(s.notices('owner').length, 0, 'not yet an hour');
  h.fail('Seerr', 'Seerr answered HTTP 503', NOW);
  s.collect({ health: h, now: NOW - 1800 + 3600 });
  s.collect({ health: h, now: NOW - 1800 + 7200 });
  h.ok('Seerr');
  s.collect({ health: h });
  s.collect({ health: h });
  assert.deepEqual(
    s.notices('owner').map(n => n.content.split(' (')[0].split(':')[0]),
    ["⚠ Media Review can't reach Seerr", '✓ Seerr is reachable again.'],
  );
});

test('Leaving Soon DMs: to friends who started it and did not finish or Downvote it, then on its last day', () => {
  const s = setup();
  for (const [id, name] of [
    ['d', 'dave'],
    ['e', 'erin'],
    ['f', 'frank'],
  ])
    s.store.upsertVoter({ plexId: id, username: name });
  /** @param {string} voter @param {string} title @param {boolean} watched @param {number} [ago] days */
  const played = (voter, title, watched, ago = 10) =>
    s.store.upsertPlays([
      {
        id: `${voter}${title}${ago}`,
        voterId: voter,
        titleKey: title,
        started: NOW - ago * DAY,
        seconds: 600,
        watched,
      },
    ]);
  played('a', 'm1', false); // started: yes
  played('b', 'm1', true); // finished the movie: no
  played('c', 'm1', false); // Downvoted it: no
  castDownvote(s.store, DEFAULTS, 'c', 'm1', NOW - 2 * DAY);
  played('d', 'm1', false, 200); // too long ago: no
  played('e', 'm1', false); // reminders off: no
  s.store.setReminders('e', false);
  played('f', 'm1', false); // never linked Discord: no
  played('a', 's1', true); // a show: one episode to the end still counts as started
  for (const v of ['a', 'b', 'c', 'd', 'e']) s.store.link(`discord-${v}`, v, v, NOW - 30 * DAY);
  s.store.remove('m1', NOW - 60, NOW + 14 * DAY);
  s.store.remove('s1', NOW - 60, NOW + 14 * DAY);

  s.collect();
  assert.deepEqual(
    s.notices('dm:discord-a').map(n => n.key),
    [],
    'off unless asked for',
  );
  s.collect({ dms: { since: NOW - DAY } });
  const sent = s.store.db.prepare("SELECT key, target FROM notices WHERE target LIKE 'dm:%' ORDER BY id").all();
  assert.deepEqual(
    sent.map(n => `${n.key} ${n.target}`),
    [`leaving-dm:m1:${NOW - 60}:a dm:discord-a`, `leaving-dm:s1:${NOW - 60}:a dm:discord-a`],
  );
  const [dm] = s.notices('dm:discord-a');
  assert.equal(dm.embeds[0].title, 'Leaving Soon: Dull Movie (2020) · Movies');
  assert.match(
    dm.embeds[0].description,
    /^You started this, and it leaves \w{3} \d+ \w{3}\. Finish it before then, or use \/object/,
  );
  assert.match(dm.embeds[0].description, /\/reminders off/);

  // Its last day: again, unless they finished it since.
  played('a', 's1', true, 1);
  played('a', 'm1', true, 1);
  s.collect({ dms: { since: NOW - DAY }, now: NOW + 13 * DAY + 60 });
  const last = s.notices('dm:discord-a').filter(n => n.key.startsWith('lastday-dm:'));
  assert.deepEqual(
    last.map(n => n.key),
    [`lastday-dm:s1:${NOW + 14 * DAY}:a`],
  );
  assert.equal(last[0].embeds[0].title, 'Last day: Long Show · TV Shows');
  assert.equal(s.collect({ dms: { since: NOW - DAY }, now: NOW + 13 * DAY + 120 }), 0, 'once');
});

test('Leaving Soon DMs: nothing for what was Removed before they were on, and only the last-day one on its last day', () => {
  const s = setup();
  s.store.upsertPlays([{ id: 'p', voterId: 'a', titleKey: 'm1', started: NOW - DAY, seconds: 600, watched: false }]);
  s.store.link('discord-a', 'a', 'a', NOW - DAY);
  s.store.remove('m1', NOW - 2 * DAY, NOW + 12 * DAY);
  s.collect({ dms: { since: NOW - DAY } });
  assert.deepEqual(s.notices('dm:discord-a'), []);
  s.store.remove('m2', NOW - 60, NOW + DAY - 60); // a one-day Leaving Soon
  s.store.upsertPlays([{ id: 'q', voterId: 'a', titleKey: 'm2', started: NOW - DAY, seconds: 600, watched: false }]);
  s.collect({ dms: { since: NOW - DAY } });
  assert.deepEqual(
    s.notices('dm:discord-a').map(n => n.key.split(':')[0]),
    ['lastday-dm'],
  );
});

test('without an Owner channel nothing is recorded for it; without an announcement channel the same', () => {
  const s = setup();
  s.store.remove('m1', NOW - 60, NOW + 14 * DAY);
  H.ask(s.store, 'a', 'm1', null, NOW); // not gone, so refused: no ask
  s.collect({ announce: false, owner: false });
  assert.equal(s.store.unsentNotices().length, 0);
});

test('deliver: oldest first; Discord down keeps the rest for next time; one bad DM holds nothing up', async () => {
  const s = setup();
  s.store.addNotice('k1', 'announce', { content: 'one' }, NOW);
  s.store.addNotice('k2', 'dm:d-gone', { content: 'dm' }, NOW);
  s.store.addNotice('k3', 'owner', { content: 'three' }, NOW);
  const posted = /** @type {string[]} */ ([]);
  let down = true;
  const api = /** @type {any} */ ({
    call: async (/** @type {string} */ method, /** @type {string} */ path, /** @type {any} */ body) => {
      if (path === '/users/@me/channels')
        throw new Error('Discord answered HTTP 403: Cannot send messages to this user');
      if (down) throw new Error("couldn't reach Discord (ECONNREFUSED)");
      posted.push(`${path} ${body.content}`);
      assert.deepEqual(body.allowed_mentions, { parse: [] }, 'never pings anyone');
      return {};
    },
  });
  const logs = /** @type {string[]} */ ([]);
  /** @param {number} t */
  const run = t =>
    N.deliver({ store: s.store, api, channels: { announce: 'A', owner: 'O' }, now: t, log: m => logs.push(m) });
  assert.deepEqual(await run(NOW), { sent: 0, error: "couldn't reach Discord (ECONNREFUSED)" });
  assert.equal(s.store.unsentNotices().length, 3);
  down = false;
  assert.deepEqual(await run(NOW + 60), { sent: 2, error: null });
  assert.deepEqual(posted, ['/channels/A/messages one', '/channels/O/messages three']);
  await run(NOW + 120);
  await run(NOW + 180); // its third try (it wasn't tried while Discord was down)
  assert.deepEqual(
    s.store.unsentNotices().map(n => n.key),
    [],
    'the DM is given up after its third try',
  );
  assert.equal(logs.length, 1, 'said once, not every minute');
});
