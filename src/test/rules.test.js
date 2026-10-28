// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, hasSampled, baseWeights, voteWeight, checkThreshold } = require('../lib/rules');

const MIN = 60;

test('a movie is Sampled at 30 minutes added up across sessions', () => {
  assert.equal(hasSampled('movie', [{ seconds: 20 * MIN, watched: false }], DEFAULTS), false);
  assert.equal(
    hasSampled(
      'movie',
      [
        { seconds: 20 * MIN, watched: false },
        { seconds: 10 * MIN, watched: false },
      ],
      DEFAULTS,
    ),
    true,
  );
});

test('a show is Sampled at 10 minutes added up across episodes and sessions', () => {
  const plays = [
    { seconds: 4 * MIN, watched: false },
    { seconds: 5 * MIN, watched: false },
  ];
  assert.equal(hasSampled('show', plays, DEFAULTS), false);
  assert.equal(hasSampled('show', [...plays, { seconds: 1 * MIN, watched: false }], DEFAULTS), true);
});

test('every Watch is a Sample, however short the recorded time', () => {
  assert.equal(hasSampled('movie', [{ seconds: 5 * MIN, watched: true }], DEFAULTS), true);
});

test('a short accidental play is neither a Watch nor a Sample', () => {
  assert.equal(hasSampled('movie', [{ seconds: 40, watched: false }], DEFAULTS), false);
  assert.equal(hasSampled('show', [], DEFAULTS), false);
});

test('Base Weight runs from 0 (no watching) to 1 (the heaviest Voter)', () => {
  const w = baseWeights(
    new Map([
      ['a', 0],
      ['b', 50],
      ['c', 200],
    ]),
  );
  assert.equal(w.get('a'), 0);
  assert.equal(w.get('b'), 0.25);
  assert.equal(w.get('c'), 1);
});

test('Base Weight is 0 for everyone when nobody has watched', () => {
  assert.equal(baseWeights(new Map([['a', 0]])).get('a'), 0);
});

test('Vote Weight is Base Weight plus a Title Bonus of 2 for a Voter who Sampled the Title', () => {
  assert.equal(voteWeight(0.5, true, DEFAULTS), 2.5);
  assert.equal(voteWeight(0.5, false, DEFAULTS), 0.5);
});

/**
 * @param {Array<[string, number, boolean, boolean]>} rows voter, base weight, sampled, downvoted
 */
const title = rows => ({
  voters: rows.map(([id, base, sampled]) => ({ id, baseWeight: base, sampled })),
  downvoters: new Set(rows.filter(r => r[3]).map(r => r[0])),
});

test('a Title below the Minimum Audience never reaches the Review Queue', () => {
  const t = title([
    ['a', 1, true, true],
    ['b', 1, true, true],
  ]);
  const r = checkThreshold(t.voters, t.downvoters, DEFAULTS);
  assert.equal(r.audience, 2);
  assert.equal(r.reached, false);
});

test('Downvotes cast below the Minimum Audience count once the Audience reaches it', () => {
  const t = title([
    ['a', 1, true, true],
    ['b', 1, true, true],
    ['c', 1, true, false],
  ]);
  const r = checkThreshold(t.voters, t.downvoters, DEFAULTS);
  assert.equal(r.audience, 3);
  assert.equal(r.reached, true);
});

test('exactly 50% of the Audience Vote Weight reaches the Review Queue', () => {
  const t = title([
    ['a', 0, true, true], // 2
    ['b', 0, true, false], // 2
    ['c', 1, true, true], // 3
    ['d', 1, true, false], // 3
  ]);
  const r = checkThreshold(t.voters, t.downvoters, DEFAULTS);
  assert.equal(r.audienceWeight, 10);
  assert.equal(r.downvoteWeight, 5);
  assert.equal(r.reached, true);
});

test('just under 50% does not', () => {
  const t = title([
    ['a', 0, true, true], // 2
    ['b', 0.1, true, false], // 2.1
    ['c', 0, true, false], // 2
  ]);
  assert.equal(checkThreshold(t.voters, t.downvoters, DEFAULTS).reached, false);
});

test('Downvotes from Voters outside the Audience are kept but carry no weight (Q5)', () => {
  const t = title([
    ['a', 0, true, false],
    ['b', 0, true, false],
    ['c', 0, true, false],
    ['x', 1, false, true],
    ['y', 1, false, true],
  ]);
  const r = checkThreshold(t.voters, t.downvoters, DEFAULTS);
  assert.equal(r.audience, 3);
  assert.equal(r.downvoteWeight, 0);
  assert.equal(r.reached, false);
});
