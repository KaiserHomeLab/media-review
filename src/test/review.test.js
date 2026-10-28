// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { DEFAULTS } = require('../lib/rules');
const { castDownvote, evaluateAll, reviewQueue } = require('../lib/review');

const NOW = 1_800_000_000;
const MIN = 60;

function setup() {
  const store = openStore(':memory:');
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie', year: 2020 },
    { ratingKey: 's1', kind: 'show', title: 'Slow Show', year: 2019 },
  ]);
  for (const id of ['a', 'b', 'c', 'd']) store.upsertVoter({ plexId: id, username: `user-${id}` });
  let n = 0;
  /** @param {string} voterId @param {string} titleKey @param {number} seconds @param {boolean} [watched] */
  const play = (voterId, titleKey, seconds, watched = false) =>
    store.upsertPlays([{ id: String(++n), voterId, titleKey, started: NOW - 3600, seconds, watched }]);
  return { store, play };
}

test('a Title reaches the Review Queue once enough of its Audience Downvotes it', () => {
  const { store, play } = setup();
  for (const v of ['a', 'b', 'c']) play(v, 'm1', 40 * MIN);
  assert.deepEqual(castDownvote(store, DEFAULTS, 'a', 'm1', NOW), { ok: true, queued: false });
  assert.deepEqual(castDownvote(store, DEFAULTS, 'b', 'm1', NOW), { ok: true, queued: true });

  const [entry] = reviewQueue(store);
  assert.equal(entry.title.name, 'Dull Movie');
  assert.equal(entry.audience, 3);
  assert.equal(entry.downvoteWeight, 6); // 2 × (1 + 2): equal watch time, so everyone has Base Weight 1
  assert.equal(entry.audienceWeight, 9);
  assert.deepEqual(
    entry.downvotes.map(d => [d.voter, d.voteWeight, d.inAudience]),
    [
      ['user-a', 3, true],
      ['user-b', 3, true],
    ],
  );
});

test('a Voter can cast only one Downvote per Title', () => {
  const { store } = setup();
  castDownvote(store, DEFAULTS, 'a', 'm1', NOW);
  assert.deepEqual(castDownvote(store, DEFAULTS, 'a', 'm1', NOW), { ok: false, error: 'already-downvoted' });
});

test('Downvotes on an unknown or already queued Title are refused', () => {
  const { store, play } = setup();
  assert.deepEqual(castDownvote(store, DEFAULTS, 'a', 'nope', NOW), { ok: false, error: 'unknown-title' });
  for (const v of ['a', 'b', 'c']) play(v, 'm1', 40 * MIN);
  castDownvote(store, DEFAULTS, 'a', 'm1', NOW);
  castDownvote(store, DEFAULTS, 'b', 'm1', NOW);
  assert.deepEqual(castDownvote(store, DEFAULTS, 'c', 'm1', NOW), { ok: false, error: 'queued' });
});

test('a Title below the Minimum Audience queues on a later sync, using Downvotes already cast', () => {
  const { store, play } = setup();
  play('a', 's1', 12 * MIN);
  play('b', 's1', 12 * MIN);
  castDownvote(store, DEFAULTS, 'a', 's1', NOW);
  castDownvote(store, DEFAULTS, 'b', 's1', NOW);
  assert.equal(reviewQueue(store).length, 0);

  play('c', 's1', 6 * MIN);
  assert.deepEqual(evaluateAll(store, DEFAULTS, NOW), []); // 6 minutes isn't a Sample yet
  play('c', 's1', 4 * MIN);
  assert.deepEqual(evaluateAll(store, DEFAULTS, NOW), ['s1']);
  assert.equal(reviewQueue(store)[0].audience, 3);
});

test('watching outside the Base Weight window does not count', () => {
  const { store, play } = setup();
  store.upsertPlays([
    { id: 'old', voterId: 'd', titleKey: 's1', started: NOW - 100 * 86400, seconds: 100 * 3600, watched: true },
  ]);
  for (const v of ['a', 'b', 'c']) play(v, 'm1', 40 * MIN);
  castDownvote(store, DEFAULTS, 'a', 'm1', NOW);
  castDownvote(store, DEFAULTS, 'b', 'm1', NOW);
  // If d's old watching counted, a, b and c would have Base Weight near 0, not 1.
  assert.equal(reviewQueue(store)[0].downvotes[0].voteWeight, 3);
});

test('plays by someone who is not a Voter (the Owner) never make an Audience', () => {
  const { store, play } = setup();
  play('a', 'm1', 40 * MIN);
  play('b', 'm1', 40 * MIN);
  play('owner', 'm1', 40 * MIN);
  castDownvote(store, DEFAULTS, 'a', 'm1', NOW);
  castDownvote(store, DEFAULTS, 'b', 'm1', NOW);
  assert.equal(reviewQueue(store).length, 0);
});
