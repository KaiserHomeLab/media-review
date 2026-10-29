// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore } = require('../lib/store');
const { DEFAULTS } = require('../lib/rules');
const { castDownvote } = require('../lib/review');
const { seerr } = require('../lib/seerr');
const { probe } = require('../lib/apps');
const H = require('../lib/holdback');

const NOW = 1_800_000_000;
const DAY = 86400;

// A Seerr that keeps a blocklist and the requests made, and answers like Seerr 3.5.
function fakeSeerr() {
  const state = {
    blocked: new Set(),
    requests: /** @type {any[]} */ ([]),
    calls: /** @type {string[]} */ ([]),
    down: false,
  };
  /** @type {typeof fetch} */
  const f = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method ?? 'GET';
    state.calls.push(`${method} ${u.pathname}${u.search}`);
    if (/** @type {any} */ (init.headers)?.['X-Api-Key'] !== 'key') return new Response('', { status: 403 });
    if (state.down) return new Response('', { status: 503 });
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (u.pathname === '/api/v1/auth/me') return Response.json({ id: 1 });
    if (u.pathname === '/api/v1/status') return Response.json({ version: '3.5.1' });
    if (method === 'POST' && u.pathname === '/api/v1/blocklist') {
      assert.equal(body.user, 1);
      const k = `${body.mediaType}:${body.tmdbId}`;
      if (state.blocked.has(k)) return new Response('', { status: 412 });
      state.blocked.add(k);
      return new Response(null, { status: 201 });
    }
    const del = u.pathname.match(/^\/api\/v1\/blocklist\/(\d+)$/);
    if (method === 'DELETE' && del) {
      const k = `${u.searchParams.get('mediaType')}:${del[1]}`;
      if (!state.blocked.delete(k)) return new Response('', { status: 404 });
      return new Response(null, { status: 204 });
    }
    if (method === 'POST' && u.pathname === '/api/v1/request') {
      if (state.blocked.has(`${body.mediaType}:${body.mediaId}`)) return new Response('', { status: 403 });
      state.requests.push(body);
      return Response.json({ id: state.requests.length }, { status: 201 });
    }
    return new Response('', { status: 404 });
  };
  return { state, fetch: f, client: seerr({ url: 'http://seerr:5055', apiKey: 'key', fetch: f }) };
}

function setup() {
  const store = openStore(':memory:');
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie', tmdbId: '603' },
    { ratingKey: 's1', kind: 'show', title: 'Slow Show', tmdbId: '1399', tvdbId: '81189' },
    { ratingKey: 'm2', kind: 'movie', title: 'No Ids' },
    { ratingKey: 'm3', kind: 'movie', title: 'Still Here', tmdbId: '700' },
  ]);
  for (const [id, name] of [
    ['a', 'alice'],
    ['b', 'bob'],
  ])
    store.upsertVoter({ plexId: id, username: name });
  const logs = /** @type {string[]} */ ([]);
  return { store, logs, log: (/** @type {string} */ m) => logs.push(m), ...fakeSeerr() };
}

/** @param {import('../lib/store').Store} store @param {string} key @param {number} at */
const deleteIt = (store, key, at) => {
  store.remove(key, at - 14 * DAY, at);
  store.deleted(key, at, ['Radarr']);
};

test("a deleted Title goes on Seerr's blocklist (a show as tv, by its TMDB id), and only once", async () => {
  const s = setup();
  deleteIt(s.store, 'm1', NOW);
  deleteIt(s.store, 's1', NOW);
  assert.deepEqual(await H.holdBack({ store: s.store, seerr: s.client, log: s.log }), ['m1', 's1']);
  assert.deepEqual([...s.state.blocked], ['movie:603', 'tv:1399']);
  assert.deepEqual(await H.holdBack({ store: s.store, seerr: s.client, log: s.log }), [], 'nothing more to do');
  assert.ok(s.logs.includes("Held back Dull Movie: on Seerr's blocklist until you bring it back"));
  assert.equal(H.gone(s.store, 'a').length, 2);
  assert.ok(!H.gone(s.store, 'a').some(g => g.ratingKey === 'm3'), 'never deleted: requested as before');
});

test('without Seerr, or without a TMDB id, it is not blocked and the Owner sees why; it is tried again', async () => {
  const s = setup();
  deleteIt(s.store, 'm1', NOW);
  deleteIt(s.store, 'm2', NOW);
  await H.holdBack({ store: s.store, seerr: null, log: s.log });
  const why = () =>
    Object.fromEntries(H.heldBackList(s.store).map(h => [h.title.ratingKey, [h.blocked, h.blockError]]));
  assert.deepEqual(why().m1, [false, 'Seerr is not set up in Media Review, so it can still be requested there']);
  s.state.down = true;
  await H.holdBack({ store: s.store, seerr: s.client, log: s.log });
  assert.deepEqual(why().m1, [false, 'Seerr answered HTTP 503']);
  s.state.down = false;
  await H.holdBack({ store: s.store, seerr: s.client, log: s.log });
  assert.deepEqual(why().m1, [true, null]);
  assert.deepEqual(why().m2, [false, "Plex has no TMDB id for it, so Seerr can't be told"]);
});

test('friends ask to bring it back, once each; the Owner sees who, with their notes, asked-for first', async () => {
  const s = setup();
  deleteIt(s.store, 'm1', NOW - DAY);
  deleteIt(s.store, 's1', NOW);
  assert.deepEqual(H.ask(s.store, 'a', 'm1', ' my favourite ', NOW), { ok: true });
  assert.deepEqual(H.ask(s.store, 'a', 'm1', null, NOW), { ok: false, error: 'already-asked' });
  assert.deepEqual(H.ask(s.store, 'b', 'm1', null, NOW + 60), { ok: true });
  assert.deepEqual(H.ask(s.store, 'a', 'm3', null, NOW), { ok: false, error: 'not-gone' });
  const [first, second] = H.heldBackList(s.store);
  assert.equal(first.title.name, 'Dull Movie');
  assert.deepEqual(
    first.asks.map(x => [x.voter, x.note]),
    [
      ['alice', 'my favourite'],
      ['bob', null],
    ],
  );
  assert.equal(second.asks.length, 0);
  assert.equal(H.gone(s.store, 'a').find(g => g.ratingKey === 'm1')?.asked, true);
  assert.equal(H.gone(s.store, 'b').find(g => g.ratingKey === 's1')?.asked, false);
  assert.deepEqual(H.withdrawAsk(s.store, 'b', 'm1'), { ok: true });
  assert.deepEqual(H.withdrawAsk(s.store, 'b', 'm1'), { ok: false, error: 'not-asked' });
});

test("the Owner sees the Title's history: who Downvoted it and how much, who objected, Keeps, Removes, deletions", async () => {
  const s = setup();
  // a and b both watched it, so their Downvotes weigh.
  for (const v of ['a', 'b'])
    s.store.upsertPlays([
      { id: `p${v}`, voterId: v, titleKey: 'm1', started: NOW - 10 * DAY, seconds: 3600, watched: true },
    ]);
  const settings = { ...DEFAULTS, minimumAudience: 2 };
  castDownvote(s.store, settings, 'a', 'm1', NOW - 9 * DAY);
  // alice's Downvote reaches the bar; bob's then comes too late (it's queued) and isn't in its history.
  assert.equal(castDownvote(s.store, settings, 'b', 'm1', NOW - 9 * DAY).ok, false);
  assert.ok(s.store.isQueued('m1'));
  // Removed; bob objects while it's Leaving Soon, not enough to send it back; then it's deleted.
  s.store.remove('m1', NOW - 14 * DAY, NOW);
  s.store.addObjection('b', 'm1', NOW - DAY);
  s.store.deleted('m1', NOW, ['Radarr']);
  const h = H.heldBackList(s.store)[0].history;
  assert.deepEqual(
    h.decisions.map(d => d.decision),
    ['remove'],
  );
  assert.deepEqual(h.deletions[0].from, ['Radarr']);
  assert.equal(h.votes.length, 2, 'one round at Remove, one at deletion');
  assert.deepEqual(
    h.votes[0].downvotes.map(d => d.voter),
    ['alice'],
  );
  assert.ok(Number(h.votes[0].downvotes[0].voteWeight) > 0);
  assert.deepEqual(h.votes[1].objections, [{ voter: 'bob', voteWeight: null }], 'not weighed: it never sent it back');
});

test('Bring back: off the blocklist and requested in Seerr; everyone who asked sees it, with the note', async () => {
  const s = setup();
  deleteIt(s.store, 's1', NOW);
  await H.holdBack({ store: s.store, seerr: s.client, log: s.log });
  H.ask(s.store, 'a', 's1', null, NOW);
  assert.deepEqual(await H.bringBack(s.store, s.client, 's1', 'On its way', NOW + 100), { ok: true });
  assert.deepEqual([...s.state.blocked], []);
  assert.deepEqual(s.state.requests, [{ mediaType: 'tv', mediaId: 1399, seasons: 'all' }]);
  assert.equal(H.heldBackList(s.store).length, 0);
  assert.equal(H.gone(s.store, 'a').length, 0);
  assert.deepEqual(
    H.asksBy(s.store, 'a', NOW + 200).map(x => [x.title, x.outcome, x.ownerNote]),
    [['Slow Show', 'brought-back', 'On its way']],
  );
  // and it isn't blocked again by the next sync, until it's deleted again
  assert.deepEqual(await H.holdBack({ store: s.store, seerr: s.client, log: s.log }), []);
  deleteIt(s.store, 's1', NOW + 90 * DAY);
  assert.deepEqual(await H.holdBack({ store: s.store, seerr: s.client, log: s.log }), ['s1']);
});

test('Bring back needs Seerr; a request Seerr refuses leaves it held back, to be blocklisted again', async () => {
  const s = setup();
  deleteIt(s.store, 'm1', NOW);
  assert.match(String(/** @type {any} */ (await H.bringBack(s.store, null, 'm1', null, NOW)).error), /Add Seerr/);
  await H.holdBack({ store: s.store, seerr: s.client, log: s.log });
  s.state.blocked.add('movie:603'); // as it is
  const refusing = seerr({
    url: 'http://seerr:5055',
    apiKey: 'key',
    fetch: async (url, init = {}) =>
      String(url).endsWith('/api/v1/request')
        ? new Response('', { status: 500 })
        : new Response(null, { status: init.method === 'DELETE' ? 204 : 200 }),
  });
  await assert.rejects(H.bringBack(s.store, refusing, 'm1', null, NOW), /HTTP 500/);
  const [h] = H.heldBackList(s.store);
  assert.equal(h.blocked, false);
  assert.match(String(h.blockError), /didn't take the request/);
});

test('Decline answers every open ask with the note; the Title stays held back', async () => {
  const s = setup();
  deleteIt(s.store, 'm1', NOW);
  assert.deepEqual(H.decline(s.store, 'm1', null, NOW), { ok: false, error: 'no-asks' });
  H.ask(s.store, 'a', 'm1', null, NOW);
  H.ask(s.store, 'b', 'm1', null, NOW);
  assert.deepEqual(H.decline(s.store, 'm1', ' Nobody watched it ', NOW + 10), { ok: true });
  assert.deepEqual(
    H.asksBy(s.store, 'b', NOW + 20).map(x => [x.outcome, x.ownerNote]),
    [['declined', 'Nobody watched it']],
  );
  assert.equal(H.heldBackList(s.store)[0].asks.length, 0);
  assert.equal(H.gone(s.store, 'a')[0].asked, false, 'they can ask again later');
  assert.equal(H.asksBy(s.store, 'b', NOW + 31 * DAY).length, 0, 'answered asks drop off after 30 days');
});

test('Titles deleted before holding back existed are held back once, when the database is opened', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-')), 'old.db');
  const old = openStore(file);
  old.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Old', tmdbId: '1' },
    { ratingKey: 'm2', kind: 'movie', title: 'Back in Plex', tmdbId: '2' },
  ]);
  // A database from before: deletions, but no held_back rows and no marker.
  old.db.exec(`DELETE FROM settings WHERE key = 'heldBackFrom';
    INSERT INTO deletions (title_key, at, deleted_from) VALUES ('m1', 5, 'Radarr'), ('m2', 6, 'Radarr');
    UPDATE titles SET seen = 0 WHERE rating_key = 'm1'`);
  old.close();
  const store = openStore(file);
  assert.deepEqual(
    store.heldBack().map(h => [h.title_key, h.since]),
    [['m1', 5]],
    'not one that is back in Plex',
  );
  store.release('m1', null, NOW);
  store.close();
  assert.equal(openStore(file).isHeldBack('m1'), false, 'only once: brought back stays brought back');
});

test("Settings' Test for Seerr: its version with the right key, and a plain refusal with a wrong one", async () => {
  const { fetch: f } = fakeSeerr();
  assert.equal(await probe('seerr', { url: 'http://seerr:5055', apiKey: 'key' }, f), '3.5.1');
  await assert.rejects(probe('seerr', { url: 'http://seerr:5055', apiKey: 'nope' }, f), /Seerr refused the API key/);
});
