// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { DEFAULTS } = require('../lib/rules');
const { castDownvote, buildingUp, reviewQueue } = require('../lib/review');
const { plex } = require('../lib/plex');
const { checkAccess } = require('../lib/access');
const bot = require('../lib/bot');

const NOW = 1_800_000_000;
const DAY = 86400;

function setup() {
  const store = openStore(':memory:');
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie' },
    { ratingKey: 'm2', kind: 'movie', title: 'Queued Movie' },
  ]);
  for (const v of ['a', 'b', 'c']) {
    store.upsertVoter({ plexId: v, username: `user-${v}` });
    for (const t of ['m1', 'm2'])
      store.upsertPlays([
        { id: `${v}${t}`, voterId: v, titleKey: t, started: NOW - 5 * DAY, seconds: 3600, watched: false },
      ]);
    store.addSession(`tok-${v}`, v, false, NOW);
  }
  const logs = /** @type {string[]} */ ([]);
  /** @param {Set<string> | Error} answer */
  const run = (answer, t = NOW) =>
    checkAccess({
      store,
      sharedWith: async () => {
        if (answer instanceof Error) throw answer;
        return answer;
      },
      machineId: async () => 'machine',
      now: () => t,
      log: m => logs.push(m),
    });
  return { store, logs, run };
}

test('someone the server is no longer shared with is signed out, and their Downvotes stop counting', async () => {
  const s = setup();
  castDownvote(s.store, DEFAULTS, 'a', 'm1', NOW - 60);
  assert.equal(buildingUp(s.store, DEFAULTS, NOW).length, 1);
  assert.deepEqual(await s.run(new Set(['b', 'c'])), { removed: ['user-a'], restored: [] });
  assert.equal(s.store.session('tok-a', 0), undefined, 'signed out');
  assert.ok(s.store.session('tok-b', 0), 'everyone else stays signed in');
  assert.equal(buildingUp(s.store, DEFAULTS, NOW).length, 0, 'their Downvote no longer counts');
  assert.equal(s.store.downvotedBy('a').size, 1, 'but it is kept');
  assert.match(s.logs[0], /user-a no longer has access/);
  // A second run changes nothing.
  assert.deepEqual(await s.run(new Set(['b', 'c'])), { removed: [], restored: [] });
});

test('shared with again: their Downvotes count again', async () => {
  const s = setup();
  castDownvote(s.store, DEFAULTS, 'a', 'm1', NOW - 60);
  await s.run(new Set(['b', 'c']));
  assert.deepEqual(await s.run(new Set(['a', 'b', 'c'])), { removed: [], restored: ['user-a'] });
  assert.equal(buildingUp(s.store, DEFAULTS, NOW).length, 1);
});

test('a Title already in the Review Queue keeps the Downvotes it was queued with', async () => {
  const s = setup();
  for (const v of ['a', 'b']) castDownvote(s.store, DEFAULTS, v, 'm2', NOW - 60);
  assert.equal(reviewQueue(s.store).length, 1);
  await s.run(new Set(['c']));
  const [q] = reviewQueue(s.store);
  assert.deepEqual(
    q.downvotes.map(d => d.voter),
    ['user-a', 'user-b'],
  );
});

test('when plex.tv fails, or lists nobody, nobody is signed out', async () => {
  const s = setup();
  assert.deepEqual(await s.run(new Error('plex.tv answered HTTP 503')), { removed: [], restored: [] });
  assert.deepEqual(await s.run(new Set()), { removed: [], restored: [] });
  assert.ok(s.store.session('tok-a', 0));
  assert.match(s.logs.join('\n'), /couldn't check .* nobody was signed out/);
  assert.match(s.logs.join('\n'), /listed nobody .* nobody was signed out/);
});

test('the bot refuses someone who no longer has access, and offers them nothing', async () => {
  const s = setup();
  s.store.link('d-a', 'a', null, NOW);
  await s.run(new Set(['b', 'c']));
  const ctx = /** @type {any} */ ({
    store: s.store,
    settings: DEFAULTS,
    now: () => NOW,
    plex: { episodes: async () => [] },
    publicUrl: () => 'https://r.example',
    leavingChanged: () => {},
    log: () => {},
  });
  const i = {
    member: { user: { id: 'd-a' } },
    data: { name: 'downvote', options: [{ name: 'title', value: 'm1', focused: true }] },
  };
  assert.match(await bot.command(ctx, i), /no longer has access/);
  assert.deepEqual(await bot.autocomplete(ctx, i), []);
  assert.equal(s.store.downvotesOf('m1').length, 0);
});

test("plex.tv's list: a share of this server counts, a pending one or another server's doesn't, the Home does", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer friendlyName="myPlex" identifier="com.plexapp.plugins.myplex" machineIdentifier="x" totalSize="5" size="5">
  <User id="11" title="alice" username="alice" home="0"><Server id="1" serverId="9" machineIdentifier="machine" name="Tower" pending="0"/></User>
  <User id="12" title="bob" username="bob" home="0"><Server id="2" serverId="9" machineIdentifier="machine" name="Tower" pending="1"/></User>
  <User id="13" title="carol" username="carol" home="0"><Server id="3" serverId="8" machineIdentifier="other" name="Elsewhere" pending="0"/></User>
  <User id="14" title="Kids" username="" home="1"/>
  <User id="15" title="dave" username="dave" home="0"></User>
</MediaContainer>`;
  const seen = /** @type {string[]} */ ([]);
  const p = plex({
    url: 'http://plex:32400',
    token: 'owner-token',
    clientId: 'c',
    fetch: /** @type {any} */ (
      async (/** @type {string} */ url, /** @type {any} */ init) => {
        seen.push(`${url} ${init.headers['X-Plex-Token']}`);
        return new Response(xml);
      }
    ),
  });
  assert.deepEqual([...(await p.sharedWith('machine'))].sort(), ['11', '14']);
  assert.deepEqual(seen, ['https://plex.tv/api/users/ owner-token']);
  const broken = plex({
    url: 'http://plex:32400',
    token: 't',
    clientId: 'c',
    fetch: /** @type {any} */ (async () => new Response('<html>maintenance</html>')),
  });
  await assert.rejects(broken.sharedWith('machine'), /wasn't what Media Review expected/);
});
