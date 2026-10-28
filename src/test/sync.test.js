// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { DEFAULTS } = require('../lib/rules');
const { tautulli } = require('../lib/tautulli');
const { sync } = require('../lib/sync');

const NOW = 1_800_000_000;

/** @param {Record<string, any>} answers by cmd @param {string[]} [calls] */
const fakeFetch = (answers, calls = []) =>
  /** @type {typeof fetch} */ (
    async url => {
      const u = new URL(String(url));
      calls.push(u.search);
      const data = answers[String(u.searchParams.get('cmd'))];
      return new Response(JSON.stringify({ response: { result: 'success', data } }));
    }
  );

const USERS = [
  { user_id: 0, username: 'Local', is_admin: 0, is_active: 1 },
  { user_id: 1, username: 'owner', is_admin: 1, is_active: 1 },
  { user_id: 2, username: 'alice', friendly_name: 'Alice', is_admin: 0, is_active: 1 },
  { user_id: 3, username: 'gone', is_admin: 0, is_active: 0 },
];
const row = (/** @type {Record<string, any>} */ r) => ({ started: NOW - 100, watched_status: 0, ...r });
const HISTORY = {
  data: [
    row({ id: 10, user_id: 2, media_type: 'movie', rating_key: 500, play_duration: 1900 }),
    row({
      id: 11,
      user_id: 2,
      media_type: 'episode',
      rating_key: 701,
      grandparent_rating_key: 700,
      duration: 300,
      watched_status: 1,
    }),
    row({ id: 12, user_id: 2, media_type: 'track', rating_key: 900, duration: 200 }),
  ],
};

test('Tautulli Voters exclude the Owner, the Local user and people no longer shared with', async () => {
  const t = tautulli({ url: 'http://tautulli:8181/', apiKey: 'k', fetch: fakeFetch({ get_users: USERS }) });
  assert.deepEqual(await t.voters(), [{ plexId: '2', username: 'Alice', thumb: null }]);
});

test('Tautulli history maps movies to themselves and episodes to their show', async () => {
  const calls = /** @type {string[]} */ ([]);
  const t = tautulli({ url: 'http://tautulli:8181', apiKey: 'k', fetch: fakeFetch({ get_history: HISTORY }, calls) });
  assert.deepEqual(await t.history('2026-10-01'), [
    { id: '10', voterId: '2', titleKey: '500', started: NOW - 100, seconds: 1900, watched: false },
    { id: '11', voterId: '2', titleKey: '700', started: NOW - 100, seconds: 300, watched: true },
  ]);
  assert.match(calls[0], /cmd=get_history/);
  assert.match(calls[0], /after=2026-10-01/);
  assert.match(calls[0], /grouping=0/);
});

test('a Tautulli failure is reported, not thrown', async () => {
  const t = tautulli({
    url: 'http://tautulli',
    apiKey: 'bad',
    fetch: async () => new Response(JSON.stringify({ response: { result: 'error', message: 'Invalid apikey' } })),
  });
  await assert.rejects(t.voters(), /Invalid apikey/);
});

test('sync pulls Voters, Titles and plays, keeps going past a failing step, and re-checks the threshold', async () => {
  const store = openStore(':memory:');
  const logs = /** @type {string[]} */ ([]);
  const users = [2, 3, 4].map(id => ({ user_id: id, username: `u${id}`, is_admin: 0, is_active: 1 }));
  const history = {
    data: [2, 3, 4].map(id => row({ id, user_id: id, media_type: 'movie', rating_key: 500, play_duration: 2400 })),
  };
  const t = tautulli({ url: 'http://t', apiKey: 'k', fetch: fakeFetch({ get_users: users, get_history: history }) });
  const plex = /** @type {any} */ ({ titles: async () => [{ ratingKey: '500', kind: 'movie', title: 'Dull Movie' }] });
  const ctx = {
    store,
    plex,
    tautulli: t,
    settings: DEFAULTS,
    now: () => NOW,
    log: (/** @type {string} */ m) => logs.push(m),
  };

  assert.deepEqual(await sync(ctx), []);
  store.addDownvote('2', '500', NOW);
  store.addDownvote('3', '500', NOW);
  // Plex is down this time: the play history still syncs and the threshold is still checked.
  ctx.plex = /** @type {any} */ ({ titles: async () => Promise.reject(new Error('Plex answered HTTP 503')) });
  assert.deepEqual(await sync(ctx), ['500']);
  assert.ok(logs.some(l => l.includes('titles failed: Plex answered HTTP 503')));
  assert.ok(logs.some(l => l.includes('Review Queue: added Dull Movie')));
  assert.equal(store.title('500')?.title, 'Dull Movie'); // the earlier catalogue is kept
});

test('sync withdraws a Downvote when the Voter has a Watch of the Title afterwards', async () => {
  const store = openStore(':memory:');
  const logs = /** @type {string[]} */ ([]);
  store.replaceTitles([{ ratingKey: '500', kind: 'movie', title: 'Dull Movie' }]);
  store.upsertVoter({ plexId: '2', username: 'u2' });
  store.addDownvote('2', '500', NOW - 1000);
  const history = {
    data: [row({ id: 1, user_id: 2, media_type: 'movie', rating_key: 500, play_duration: 6000, watched_status: 1 })],
  };
  const t = tautulli({ url: 'http://t', apiKey: 'k', fetch: fakeFetch({ get_users: [], get_history: history }) });
  const plex = /** @type {any} */ ({ titles: async () => [{ ratingKey: '500', kind: 'movie', title: 'Dull Movie' }] });
  await sync({ store, plex, tautulli: t, settings: DEFAULTS, now: () => NOW, log: m => logs.push(m) });
  assert.equal(store.downvotesOf('500').length, 0);
  assert.ok(logs.includes('Downvote withdrawn by a Watch: Dull Movie'));
});
