// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
// Overnight is server time; pin a zone so these mean the same on every machine.
process.env.TZ = 'Europe/Amsterdam';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { DEFAULTS } = require('../lib/rules');
const { arr } = require('../lib/arr');
const { keep } = require('../lib/review');
const { runDeletions } = require('../lib/deletions');

/** @param {string} local Amsterdam time @returns {number} unix seconds */
const at = local => Math.floor(new Date(local.replace(' ', 'T')).getTime() / 1000);
const ENDS = at('2026-11-12 04:00');

// A Radarr or Sonarr holding some items, answering list and delete, and recording every call.
/** @param {'radarr' | 'sonarr'} kind @param {string} name @param {Array<Record<string, number>>} items */
function fakeArr(kind, name, items) {
  const calls = /** @type {string[]} */ ([]);
  const state = { items: [...items], down: false };
  /** @type {typeof fetch} */
  const f = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push(`${init.method ?? 'GET'} ${u.pathname}${u.search}`);
    if (/** @type {any} */ (init.headers)?.['X-Api-Key'] !== 'key') return new Response('', { status: 401 });
    if (state.down) return new Response('', { status: 503 });
    const m = u.pathname.match(/^\/api\/v3\/(movie|series)(?:\/(\d+))?$/);
    if (m && !m[2]) return new Response(JSON.stringify(state.items));
    if (m && init.method === 'DELETE') {
      state.items = state.items.filter(i => i.id !== Number(m[2]));
      return new Response('');
    }
    return new Response('', { status: 404 });
  };
  return { calls, state, arr: arr({ name, kind, url: `http://${kind}`, apiKey: 'key', fetch: f }) };
}

function setup() {
  const store = openStore(':memory:');
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie', tmdbId: '603' },
    { ratingKey: 's1', kind: 'show', title: 'Loud Anime', tvdbId: '81189' },
    { ratingKey: 'm2', kind: 'movie', title: 'Hand Added', tmdbId: '999' },
  ]);
  for (const key of ['m1', 's1', 'm2']) store.remove(key, ENDS - 14 * 86400, ENDS);
  const radarr = fakeArr('radarr', 'Radarr', [{ id: 7, tmdbId: 603 }]);
  const tv = fakeArr('sonarr', 'Sonarr', [{ id: 3, tvdbId: 1 }]);
  const anime = fakeArr('sonarr', 'Sonarr (anime)', [{ id: 12, tvdbId: 81189 }]);
  const logs = /** @type {string[]} */ ([]);
  /** @param {number} t */
  const run = t =>
    runDeletions({
      store,
      arrs: [radarr.arr, tv.arr, anime.arr],
      settings: DEFAULTS,
      now: () => t,
      log: m => logs.push(m),
    });
  /** @param {string} key */
  const leaving = key => store.leavingSoon().find(l => l.title_key === key);
  return { store, radarr, tv, anime, logs, run, leaving };
}

test('nothing is deleted before the end date, or outside 04:00 to 07:00', async () => {
  const s = setup();
  assert.deepEqual(await s.run(at('2026-11-11 05:00')), [], 'a night too early');
  assert.deepEqual(await s.run(at('2026-11-12 03:59')), [], 'before the window');
  assert.deepEqual(await s.run(at('2026-11-12 13:00')), [], 'missed the night: waits for the next one');
  assert.deepEqual([...s.radarr.calls, ...s.tv.calls, ...s.anime.calls], []);
});

test('overnight, a movie goes from Radarr and an anime show from the Sonarr that has it, with an exclusion', async () => {
  const s = setup();
  assert.deepEqual(await s.run(at('2026-11-12 04:15')), ['m1', 's1']);
  assert.ok(s.radarr.calls.includes('DELETE /api/v3/movie/7?deleteFiles=true&addImportExclusion=true'));
  assert.ok(s.anime.calls.includes('DELETE /api/v3/series/12?deleteFiles=true&addImportListExclusion=true'));
  assert.ok(!s.tv.calls.some(c => c.startsWith('DELETE')), 'the TV Sonarr does not have it');

  assert.equal(s.leaving('m1'), undefined);
  assert.equal(s.store.searchTitles('Dull', 10).length, 0, 'gone from the library');
  assert.deepEqual(
    s.store.deletionsOf('s1').map(d => d.deleted_from),
    ['Sonarr (anime)'],
  );
  assert.ok(s.logs.includes('Deleted Dull Movie from Radarr, with an import-list exclusion'));
});

test('a Title in neither Radarr nor Sonarr is not deleted, and the Owner is told why', async () => {
  const s = setup();
  await s.run(at('2026-11-12 04:15'));
  assert.equal(s.leaving('m2')?.delete_error, 'not found in Radarr, so nothing was deleted');
  assert.equal(s.store.deletionsOf('m2').length, 0);
});

test('running it again deletes nothing more', async () => {
  const s = setup();
  await s.run(at('2026-11-12 04:15'));
  const before = s.radarr.calls.filter(c => c.startsWith('DELETE')).length;
  assert.deepEqual(await s.run(at('2026-11-12 04:30')), []);
  assert.equal(s.radarr.calls.filter(c => c.startsWith('DELETE')).length, before);
});

test('an app that is down leaves the Title Leaving Soon, with the error, and the next night finishes it', async () => {
  const s = setup();
  s.radarr.state.down = true;
  await s.run(at('2026-11-12 04:15'));
  assert.equal(s.leaving('m1')?.delete_error, 'Radarr: Radarr answered HTTP 503');
  assert.equal(s.store.deletionsOf('m1').length, 0, 'never marked deleted when it is not');

  s.radarr.state.down = false;
  assert.ok((await s.run(at('2026-11-13 04:15'))).includes('m1'));
  assert.equal(s.leaving('m1'), undefined);
});

test('a show deleted from one Sonarr while the other failed is finished the next night', async () => {
  const s = setup();
  s.tv.state.items.push({ id: 4, tvdbId: 81189 }); // a second copy, in the TV Sonarr
  s.anime.state.down = true;
  await s.run(at('2026-11-12 04:15'));
  assert.equal(s.leaving('s1')?.deleted_from, 'Sonarr');
  assert.match(String(s.leaving('s1')?.delete_error), /^Sonarr \(anime\): /);

  s.anime.state.down = false;
  await s.run(at('2026-11-13 04:15'));
  assert.deepEqual(
    s.store.deletionsOf('s1').map(d => d.deleted_from),
    ['Sonarr,Sonarr (anime)'],
  );
});

test('a Title Kept after all is never deleted', async () => {
  const s = setup();
  keep(s.store, 'm1', ENDS - 86400);
  await s.run(at('2026-11-12 04:15'));
  assert.ok(!s.radarr.calls.some(c => c.startsWith('DELETE')));
  assert.equal(s.store.deletionsOf('m1').length, 0);
});
