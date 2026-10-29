// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { DEFAULTS } = require('../lib/rules');
const { castDownvote, buildingUp, keepEarly, removeEarly, reviewQueue } = require('../lib/review');

const NOW = 1_800_000_000;
const DAY = 86400;

function setup() {
  const store = openStore(':memory:');
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Close One' },
    { ratingKey: 'm2', kind: 'movie', title: 'Far One' },
    { ratingKey: 'm3', kind: 'movie', title: 'Nobody Minds' },
  ]);
  for (const v of ['a', 'b', 'c', 'd']) {
    store.upsertVoter({ plexId: v, username: `user-${v}` });
    // Everyone watches the same amount overall, so each has Base Weight 1.
    store.upsertPlays([
      { id: `w${v}`, voterId: v, titleKey: 'm3', started: NOW - 5 * DAY, seconds: 36000, watched: true },
    ]);
  }
  // a, b and c tried "Close One"; only a tried "Far One".
  for (const v of ['a', 'b', 'c'])
    store.upsertPlays([
      { id: `m1${v}`, voterId: v, titleKey: 'm1', started: NOW - DAY, seconds: 3600, watched: false },
    ]);
  store.upsertPlays([{ id: 'm2a', voterId: 'a', titleKey: 'm2', started: NOW - DAY, seconds: 3600, watched: false }]);
  return store;
}

test('every Title with Downvotes below the bar, closest first, with who and how much each weighs', () => {
  const store = setup();
  castDownvote(store, DEFAULTS, 'a', 'm1', NOW - 60); // a, b and c tried it; a watches most (Base 1, so 3), b and c a little less
  castDownvote(store, DEFAULTS, 'd', 'm2', NOW - 50); // d never tried it: counts for nothing yet
  const list = buildingUp(store, DEFAULTS, NOW);
  assert.deepEqual(
    list.map(x => x.title.name),
    ['Close One', 'Far One'],
  );
  const [close, far] = list;
  assert.deepEqual([close.downvoteWeight, close.neededWeight, close.audience, close.minimumAudience], [3, 4.42, 3, 3]); // half of 3 + 2.92 + 2.92
  assert.deepEqual(
    close.downvotes.map(d => [d.voter, d.voteWeight, d.counts]),
    [['user-a', 3, true]],
  );
  assert.deepEqual(
    far.downvotes.map(d => [d.voter, d.voteWeight, d.counts]),
    [['user-d', 0, false]],
  );
  assert.ok(close.progress > far.progress);
  assert.equal(reviewQueue(store).length, 0, 'none of it is in the queue');
});

test('once at the bar it leaves Building up for the Review Queue', () => {
  const store = setup();
  castDownvote(store, DEFAULTS, 'a', 'm1', NOW - 60);
  castDownvote(store, DEFAULTS, 'b', 'm1', NOW - 50);
  assert.equal(buildingUp(store, DEFAULTS, NOW).length, 0);
  assert.equal(reviewQueue(store).length, 1);
});

test('Keep now clears its Downvotes; Remove now sends it to Leaving Soon with its Downvotes kept as history', () => {
  const store = setup();
  castDownvote(store, DEFAULTS, 'a', 'm1', NOW - 60);
  castDownvote(store, DEFAULTS, 'd', 'm2', NOW - 50);
  assert.deepEqual(keepEarly(store, 'm1', NOW), { ok: true });
  assert.equal(store.downvotesOf('m1').length, 0);
  assert.deepEqual(
    store.decisionsOf('m1').map(d => d.decision),
    ['keep'],
  );
  assert.deepEqual(keepEarly(store, 'm3', NOW), { ok: false, error: 'not-building-up' });

  const r = removeEarly(store, DEFAULTS, 'm2', NOW);
  assert.ok(r.ok);
  assert.ok(store.isLeaving('m2'));
  assert.equal(reviewQueue(store).length, 0);
  assert.deepEqual(
    store.votesOf('m2').map(v => [v.voter_id, v.kind]),
    [['d', 'downvote']],
  );
  assert.deepEqual(removeEarly(store, DEFAULTS, 'm2', NOW), { ok: false, error: 'not-building-up' });
  assert.equal(buildingUp(store, DEFAULTS, NOW).length, 0);
});
