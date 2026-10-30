// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { DEFAULTS } = require('../lib/rules');
const review = require('../lib/review');
const H = require('../lib/holdback');
const P = require('../lib/problems');
const { titleHistory } = require('../lib/history');

const NOW = 1_800_000_000;
const DAY = 86400;

function setup() {
  const store = openStore(':memory:');
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie', year: 2020, library: 'Movies', thumb: '/t' },
    { ratingKey: 'm2', kind: 'movie', title: 'Dull Sequel', library: 'Movies' },
  ]);
  for (const [id, name] of [
    ['a', 'alice'],
    ['b', 'bob'],
    ['c', 'carol'],
  ])
    store.upsertVoter({ plexId: id, username: name });
  /** @param {string[]} voters @param {number} at */
  const queue = (voters, at) => {
    for (const v of voters) store.addDownvote(v, 'm1', at - 60);
    store.enqueue(
      'm1',
      at,
      { audience: 3, audienceWeight: 9, downvoteWeight: 6 },
      voters.map(v => ({ voterId: v, voteWeight: 3, inAudience: true, createdAt: at - 60 })),
    );
  };
  return { store, queue };
}

test("a Title's whole story: Kept once, Removed, deleted, asked for back, with who and when", async () => {
  const { store, queue } = setup();
  queue(['a', 'b'], NOW - 60 * DAY);
  review.keep(store, 'm1', NOW - 59 * DAY);
  queue(['b', 'c'], NOW - 30 * DAY);
  review.remove(store, DEFAULTS, 'm1', NOW - 29 * DAY);
  store.deleted('m1', NOW - 15 * DAY, ['Radarr']);
  H.ask(store, 'a', 'm1', 'please', NOW - 10 * DAY);
  H.decline(store, 'm1', 'Too dull', NOW - 9 * DAY);
  store.upsertPlays([
    { id: 'p1', voterId: 'a', titleKey: 'm1', started: NOW - 70 * DAY, seconds: 1800, watched: false },
    { id: 'p2', voterId: 'a', titleKey: 'm1', started: NOW - 65 * DAY, seconds: 1200, watched: false },
    { id: 'p3', voterId: 'c', titleKey: 'm1', started: NOW - 40 * DAY, seconds: 5400, watched: true },
  ]);

  const h = titleHistory(store, 'm1', { posterUrl: k => `/poster/${k}` });
  assert.ok(h);
  assert.deepEqual(h.title, {
    ratingKey: 'm1',
    name: 'Dull Movie',
    year: 2020,
    kind: 'movie',
    library: 'Movies',
    inPlex: false, // deleted
    poster: '/poster/m1',
  });
  assert.match(h.now, /^Deleted \d{4}-\d{2}-\d{2}, held back$/);
  assert.deepEqual(
    h.events.map(e => [e.kind, e.text, ...(e.people ?? []), ...(e.note ? [e.note] : [])]),
    [
      ['ask-done', 'Declined for alice', 'Too dull'],
      ['ask', 'alice asked to bring it back', 'please'],
      ['deleted', 'Deleted from Radarr'],
      ['remove', 'Removed: Leaving Soon', 'Downvoted by bob (3), carol (3)'],
      ['keep', 'Kept', 'Downvoted by alice (3), bob (3)'],
    ],
  );
  assert.deepEqual(h.viewers, [
    { voter: 'carol', last: new Date((NOW - 40 * DAY) * 1000).toISOString(), minutes: 90, finished: true, plays: 1 },
    { voter: 'alice', last: new Date((NOW - 65 * DAY) * 1000).toISOString(), minutes: 50, finished: false, plays: 2 },
  ]);
  // Held back, its history still says only who Downvoted when it was Removed.
  const [held] = H.heldBackList(store);
  assert.deepEqual(
    held.history.votes.map(r => r.downvotes.map(d => d.voter)),
    [['bob', 'carol']],
  );
});

test('in the library now: its Downvotes so far, a Problem Report, and nothing else', async () => {
  const { store } = setup();
  store.addDownvote('a', 'm2', NOW - DAY);
  const r = await P.report(store, 'b', { titleKey: 'm2', reason: 'audio', note: 'no sound' }, NOW - 60, async () => []);
  assert.ok(r.ok);
  const h = titleHistory(store, 'm2');
  assert.equal(h?.now, 'In the library, 1 Downvote so far');
  assert.deepEqual(
    h?.events.map(e => [e.kind, e.text, ...(e.people ?? [])]),
    [
      ['problem', 'Problem Report: Audio', 'bob: “no sound”'],
      ['downvote', 'Downvoted by alice'],
    ],
  );
  assert.equal(h?.title.poster, null);
  assert.equal(titleHistory(store, 'nope'), null);
});

test('search finds Titles no longer in Plex too, those in Plex first', () => {
  const { store } = setup();
  store.replaceTitles([{ ratingKey: 'm2', kind: 'movie', title: 'Dull Sequel', library: 'Movies' }]); // m1 left Plex
  assert.deepEqual(
    store.findTitles('dull', 20).map(t => [t.rating_key, t.seen]),
    [
      ['m2', 1],
      ['m1', 0],
    ],
  );
  assert.deepEqual(store.findTitles('100%', 20), []);
});
