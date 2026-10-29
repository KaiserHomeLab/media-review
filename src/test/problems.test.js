// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { DEFAULTS } = require('../lib/rules');
const { castDownvote, reviewQueue } = require('../lib/review');
const P = require('../lib/problems');

const NOW = 1_800_000_000;
const EPISODES = async () => [
  { season: 1, episode: 1, title: 'Pilot' },
  { season: 1, episode: 2, title: 'The Second One' },
  { season: 2, episode: 1, title: 'Back Again' },
];

function setup() {
  const store = openStore(':memory:');
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie' },
    { ratingKey: 's1', kind: 'show', title: 'Slow Show' },
  ]);
  for (const [id, name] of [
    ['a', 'alice'],
    ['b', 'bob'],
  ])
    store.upsertVoter({ plexId: id, username: name });
  return store;
}

test('a report on an episode names it; a whole season, or a whole movie, has no episode', async () => {
  const store = setup();
  const ep = await P.report(store, 'a', { titleKey: 's1', season: 1, episode: 2, reason: 'audio' }, NOW, EPISODES);
  const season = await P.report(store, 'a', { titleKey: 's1', season: '2', reason: 'video' }, NOW, EPISODES);
  const movie = await P.report(
    store,
    'b',
    { titleKey: 'm1', reason: 'wont-play', note: ' stops at 20 min ' },
    NOW,
    EPISODES,
  );
  assert.ok(ep.ok && season.ok && movie.ok);
  assert.deepEqual(
    P.openReports(store).map(r => [r.title.name, r.part, r.reasonLabel, r.reporters.map(x => [x.voter, x.note])]),
    [
      ['Slow Show', 'S1 E2 · The Second One', 'Audio', [['alice', null]]],
      ['Slow Show', 'Season 2', 'Video', [['alice', null]]],
      ['Dull Movie', null, "Won't play", [['bob', 'stops at 20 min']]],
    ],
  );
});

test('a part that is not in Plex, a missing reason, or Other with no note is refused', async () => {
  const store = setup();
  /** @param {Record<string, unknown>} input */
  const r = input => P.report(store, 'a', { titleKey: 's1', reason: 'audio', ...input }, NOW, EPISODES);
  assert.deepEqual(await r({ season: 3 }), { ok: false, error: 'unknown-part' });
  assert.deepEqual(await r({ season: 1, episode: 9 }), { ok: false, error: 'unknown-part' });
  assert.deepEqual(await r({ episode: 1 }), { ok: false, error: 'unknown-part' }, 'an episode needs its season');
  assert.deepEqual(await r({ season: -1 }), { ok: false, error: 'unknown-part' });
  assert.deepEqual(await r({ reason: 'meh' }), { ok: false, error: 'pick-a-reason' });
  assert.deepEqual(await r({ reason: 'other', note: '  ' }), { ok: false, error: 'say-what' });
  assert.deepEqual(
    await P.report(store, 'a', { titleKey: 'm1', season: 1, reason: 'audio' }, NOW, EPISODES),
    { ok: false, error: 'unknown-part' },
    'a movie has no seasons',
  );
  assert.equal(P.openReports(store).length, 0);
});

test('the same problem again joins the open report: me too, once each', async () => {
  const store = setup();
  const first = await P.report(
    store,
    'a',
    { titleKey: 's1', season: 1, episode: 1, reason: 'subtitles' },
    NOW,
    EPISODES,
  );
  const again = await P.report(
    store,
    'b',
    { titleKey: 's1', season: 1, episode: 1, reason: 'subtitles', note: 'out of sync' },
    NOW + 60,
    EPISODES,
  );
  assert.ok(first.ok && again.ok);
  assert.equal(again.id, first.id);
  assert.equal(again.joined, true);
  assert.deepEqual(
    await P.report(store, 'b', { titleKey: 's1', season: 1, episode: 1, reason: 'subtitles' }, NOW, EPISODES),
    {
      ok: false,
      error: 'already-reported',
    },
  );
  assert.deepEqual(P.meToo(store, 'a', first.id, null, NOW), { ok: false, error: 'already-reported' });
  // A different reason, or the whole season, is a different problem.
  const other = await P.report(store, 'b', { titleKey: 's1', season: 1, reason: 'subtitles' }, NOW, EPISODES);
  assert.ok(other.ok && other.id !== first.id);
  assert.deepEqual(
    P.openReports(store)[0].reporters.map(r => r.voter),
    ['alice', 'bob'],
  );
});

test('resolved and closed reports leave the open list, and each reporter sees which, with the note', async () => {
  const store = setup();
  const one = await P.report(store, 'a', { titleKey: 'm1', reason: 'quality' }, NOW, EPISODES);
  const two = await P.report(store, 'a', { titleKey: 's1', reason: 'audio' }, NOW, EPISODES);
  assert.ok(one.ok && two.ok);
  P.meToo(store, 'b', one.id, 'blurry', NOW);
  assert.deepEqual(P.decide(store, one.id, 'resolved', ' Replaced with a 1080p copy ', NOW + 100), { ok: true });
  assert.deepEqual(P.decide(store, two.id, 'closed', '', NOW + 200), { ok: true });
  assert.deepEqual(P.decide(store, two.id, 'resolved', null, NOW + 300), { ok: false, error: 'not-open' });
  assert.deepEqual(P.openReports(store), []);

  const bob = P.reportsBy(store, 'b', NOW + 400);
  assert.deepEqual(
    bob.map(r => [r.title.name, r.outcome, r.ownerNote, r.note]),
    [['Dull Movie', 'resolved', 'Replaced with a 1080p copy', 'blurry']],
    'only their own, with their own note',
  );
  assert.deepEqual(
    P.reportsBy(store, 'a', NOW + 400).map(r => [r.title.name, r.outcome, r.ownerNote]),
    [
      ['Slow Show', 'closed', null],
      ['Dull Movie', 'resolved', 'Replaced with a 1080p copy'],
    ],
  );
  assert.equal(P.reportsBy(store, 'a', NOW + 31 * 86400).length, 0, 'decided ones drop off after 30 days');
});

test('withdrawing takes a Voter off; the report goes when nobody is left on it', async () => {
  const store = setup();
  const r = await P.report(store, 'a', { titleKey: 'm1', reason: 'audio' }, NOW, EPISODES);
  assert.ok(r.ok);
  P.meToo(store, 'b', r.id, null, NOW);
  assert.deepEqual(P.withdrawReport(store, 'a', r.id), { ok: true });
  assert.deepEqual(P.withdrawReport(store, 'a', r.id), { ok: false, error: 'not-reported' });
  assert.equal(P.openReports(store).length, 1);
  P.withdrawReport(store, 'b', r.id);
  assert.equal(P.openReports(store).length, 0);
  assert.equal(store.problem(r.id), undefined);
});

test('a Problem Report never counts as a Downvote', async () => {
  const store = setup();
  for (const v of ['a', 'b']) await P.report(store, v, { titleKey: 'm1', reason: 'wont-play' }, NOW, EPISODES);
  assert.equal(store.downvotesOf('m1').length, 0);
  assert.equal(reviewQueue(store).length, 0);
  // and a Downvote and a Problem Report on the same Title live side by side
  castDownvote(store, DEFAULTS, 'a', 'm1', NOW);
  assert.equal(store.downvotesOf('m1').length, 1);
  assert.equal(P.openReports(store)[0].reporters.length, 2);
});

test('the open reports on a Title say which are mine, and never who else', async () => {
  const store = setup();
  const r = await P.report(store, 'a', { titleKey: 'm1', reason: 'audio', note: 'secret' }, NOW, EPISODES);
  assert.ok(r.ok);
  const seen = P.openOn(store, 'b', 'm1');
  assert.deepEqual(
    seen.map(x => ({ id: x.id, reason: x.reasonLabel, mine: x.mine })),
    [{ id: r.id, reason: 'Audio', mine: false }],
  );
  assert.ok(!JSON.stringify(seen).includes('alice') && !JSON.stringify(seen).includes('secret'));
  assert.equal(P.openOn(store, 'a', 'm1')[0].mine, true);
});
