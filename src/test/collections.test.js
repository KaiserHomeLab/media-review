// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { DEFAULTS } = require('../lib/rules');
const { plex: plexClient } = require('../lib/plex');
const { castDownvote, remove, keep } = require('../lib/review');
const { syncLeavingSoon } = require('../lib/collections');

const NOW = 1_800_000_000;

// A Plex server that keeps its collections and pinned hubs, answering the calls Plex Web makes.
function fakePlex() {
  /** @type {Map<string, { section: string, title: string, items: string[] }>} */
  const collections = new Map();
  /** @type {Map<string, Record<string, any>>} identifier → managed hub */
  const hubs = new Map();
  const calls = /** @type {string[]} */ ([]);
  let next = 900;
  let down = false;
  const json = (/** @type {unknown} */ body) => new Response(JSON.stringify(body));
  const empty = () => new Response('');
  /** @param {string} uri */
  const keysOf = uri => uri.split('/library/metadata/')[1].split(',');

  /** @type {typeof fetch} */
  const f = async (url, init = {}) => {
    const u = new URL(String(url));
    const m = init.method ?? 'GET';
    const p = u.pathname;
    const q = u.searchParams;
    calls.push(`${m} ${p}`);
    if (down) return new Response('', { status: 503 });
    /** @type {any} */ // the last route match
    let r;
    if (m === 'GET' && (r = p.match(/^\/library\/sections\/(\w+)\/collections$/)))
      return json({
        MediaContainer: {
          Metadata: [...collections]
            .filter(([, c]) => c.section === r[1])
            .map(([id, c]) => ({ ratingKey: id, title: c.title })),
        },
      });
    if (m === 'GET' && (r = p.match(/^\/library\/collections\/(\w+)\/children$/)))
      return json({ MediaContainer: { Metadata: collections.get(r[1])?.items.map(k => ({ ratingKey: k })) ?? [] } });
    if (m === 'POST' && p === '/library/collections') {
      const id = String(next++);
      collections.set(id, {
        section: String(q.get('sectionId')),
        title: String(q.get('title')),
        items: keysOf(String(q.get('uri'))),
      });
      return json({ MediaContainer: { Metadata: [{ ratingKey: id }] } });
    }
    if (m === 'PUT' && (r = p.match(/^\/library\/collections\/(\w+)\/items$/))) {
      collections.get(r[1])?.items.push(...keysOf(String(q.get('uri'))));
      return empty();
    }
    if (m === 'DELETE' && (r = p.match(/^\/library\/collections\/(\w+)\/items\/(\w+)$/))) {
      const c = collections.get(r[1]);
      if (c) c.items = c.items.filter(k => k !== r[2]);
      return empty();
    }
    if (m === 'DELETE' && (r = p.match(/^\/library\/metadata\/(\w+)$/))) {
      collections.delete(r[1]);
      for (const [h, hub] of hubs) if (hub.id === r[1]) hubs.delete(h);
      return empty();
    }
    if (m === 'GET' && (r = p.match(/^\/hubs\/sections\/(\w+)\/manage$/)))
      return json({ MediaContainer: { Hub: [...hubs.values()].filter(h => h.section === r[1]) } });
    const pins = {
      promotedToRecommended: q.get('promotedToRecommended') === '1',
      promotedToOwnHome: q.get('promotedToOwnHome') === '1',
      promotedToSharedHome: q.get('promotedToSharedHome') === '1',
    };
    if (m === 'POST' && (r = p.match(/^\/hubs\/sections\/(\w+)\/manage$/))) {
      const id = String(q.get('metadataItemId'));
      const identifier = `custom.collection.${r[1]}.${id}`;
      hubs.set(identifier, { identifier, section: r[1], id, ...pins });
      return empty();
    }
    if (m === 'PUT' && (r = p.match(/^\/hubs\/sections\/(\w+)\/manage\/(.+)$/))) {
      const hub = hubs.get(decodeURIComponent(r[2]));
      if (hub) Object.assign(hub, pins);
      return empty();
    }
    return new Response('', { status: 404 });
  };
  return {
    collections,
    hubs,
    calls,
    setDown: (/** @type {boolean} */ d) => (down = d),
    plex: plexClient({ url: 'http://plex:32400', token: 't', clientId: 'c', fetch: f }),
  };
}

function setup() {
  const store = openStore(':memory:');
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie', library: 'Movies', libraryKey: '1' },
    { ratingKey: 'm2', kind: 'movie', title: 'Beige Horizon', library: 'Movies', libraryKey: '1' },
    { ratingKey: 's1', kind: 'show', title: 'Slow Show', library: 'TV Shows', libraryKey: '2' },
  ]);
  for (const v of ['a', 'b', 'c']) store.upsertVoter({ plexId: v, username: v });
  let n = 0;
  for (const key of ['m1', 'm2'])
    for (const v of ['a', 'b', 'c'])
      store.upsertPlays([
        { id: String(++n), voterId: v, titleKey: key, started: NOW - 60, seconds: 3600, watched: true },
      ]);
  /** Queue a Title, then Remove it. @param {string} key */
  const removeTitle = key => {
    castDownvote(store, DEFAULTS, 'a', key, NOW);
    castDownvote(store, DEFAULTS, 'b', key, NOW);
    assert.equal(remove(store, DEFAULTS, key, NOW).ok, true);
  };
  const fake = fakePlex();
  const logs = /** @type {string[]} */ ([]);
  const sync = () => syncLeavingSoon({ store, plex: fake.plex, machineId: async () => 'mach', log: m => logs.push(m) });
  return { store, fake, logs, sync, removeTitle };
}

const pinnedEverywhere = { promotedToRecommended: true, promotedToOwnHome: true, promotedToSharedHome: true };

test('the first Removed Title makes a Leaving Soon collection in its library, pinned everywhere', async () => {
  const { fake, sync, removeTitle } = setup();
  assert.equal(await sync(), true);
  assert.equal(fake.collections.size, 0, 'nothing Leaving Soon: nothing made');

  removeTitle('m1');
  assert.equal(await sync(), true);
  const [[id, c]] = [...fake.collections];
  assert.deepEqual(c, { section: '1', title: 'Leaving Soon', items: ['m1'] });
  const { promotedToRecommended, promotedToOwnHome, promotedToSharedHome } =
    fake.hubs.get(`custom.collection.1.${id}`) ?? {};
  assert.deepEqual({ promotedToRecommended, promotedToOwnHome, promotedToSharedHome }, pinnedEverywhere);
  assert.equal([...fake.collections.values()].filter(x => x.section === '2').length, 0, 'nothing made in TV Shows');
});

test('a collection someone deleted is made again, and one someone unpinned is pinned again', async () => {
  const { fake, sync, removeTitle } = setup();
  removeTitle('m1');
  await sync();
  fake.collections.clear();
  fake.hubs.clear();
  await sync();
  const [[id]] = [...fake.collections];
  assert.equal(fake.hubs.get(`custom.collection.1.${id}`)?.promotedToSharedHome, true);

  Object.assign(/** @type {any} */ (fake.hubs.get(`custom.collection.1.${id}`)), { promotedToSharedHome: false });
  await sync();
  assert.equal(fake.hubs.get(`custom.collection.1.${id}`)?.promotedToSharedHome, true);
  assert.equal(fake.collections.size, 1, 'not made twice');
});

test('Titles join and leave the collection, and the last one leaving deletes it', async () => {
  const { store, fake, sync, removeTitle } = setup();
  removeTitle('m1');
  await sync();
  removeTitle('m2');
  await sync();
  assert.deepEqual([...fake.collections.values()][0].items, ['m1', 'm2']);

  keep(store, 'm1', NOW + 60); // Keep after all
  await sync();
  assert.deepEqual([...fake.collections.values()][0].items, ['m2']);

  keep(store, 'm2', NOW + 60);
  await sync();
  assert.equal(fake.collections.size, 0);
  assert.equal(fake.hubs.size, 0);
});

test('Plex being down is logged, not thrown, and the next sync catches up', async () => {
  const { fake, logs, sync, removeTitle } = setup();
  removeTitle('m1');
  fake.setDown(true);
  assert.equal(await sync(), false);
  assert.ok(logs.some(l => /could not update Leaving Soon in library 1: Plex answered HTTP 503/.test(l)));
  fake.setDown(false);
  assert.equal(await sync(), true);
  assert.deepEqual([...fake.collections.values()][0].items, ['m1']);
});
