// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openStore } = require('../lib/store');
const { DEFAULTS, quietTime } = require('../lib/rules');
const { createApp } = require('../lib/web');
const { appSettings } = require('../lib/apps');

const NOW = 1_800_000_000;

// Plex with three accounts: the Owner, a shared Voter per pin, and a stranger.
const ACCOUNTS =
  /** @type {Record<number, { plexId: string, username: string, access: 'owner' | 'shared' | 'none' }>} */ ({
    1: { plexId: 'owner', username: 'Owner', access: 'owner' },
    2: { plexId: 'a', username: 'alice', access: 'shared' },
    3: { plexId: 'b', username: 'bob', access: 'shared' },
    4: { plexId: 'x', username: 'stranger', access: 'none' },
    5: { plexId: 'c', username: 'carol', access: 'shared' },
    6: { plexId: 'd', username: 'dave', access: 'shared' },
  });
const fakePlex = /** @type {any} */ ({
  createPin: async () => ({ id: 2, code: 'CODE' }),
  authUrl: (/** @type {string} */ code, /** @type {string} */ fwd) =>
    `https://app.plex.tv/auth#?code=${code}&forwardUrl=${fwd}`,
  pinToken: async (/** @type {number} */ id) => (ACCOUNTS[id] ? `token-${id}` : null),
  account: async (/** @type {string} */ token) => ({ ...ACCOUNTS[Number(token.slice(6))], thumb: null }),
  poster: async () => new Response('img', { headers: { 'content-type': 'image/jpeg' } }),
  episodes: async () => [
    { season: 1, episode: 1, title: 'Pilot' },
    { season: 1, episode: 2, title: 'Two' },
  ],
});

/** @param {{ publicUrl?: string, leavingChanged?: () => void, seerr?: () => any, updates?: any }} [extra] */
async function setup(extra = {}) {
  const logs = /** @type {string[]} */ ([]);
  const store = openStore(':memory:');
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie', year: 2020, thumb: '/library/m1/thumb' },
  ]);
  // An install whose first setup is done: Plex is linked.
  const apps = appSettings(store);
  apps.setPlex({ url: 'http://plex:32400', token: 'owner-token', machineId: 'machine', name: 'Tower' });
  const app = createApp({
    store,
    apps,
    plex: fakePlex,
    machineId: async () => 'machine',
    settings: DEFAULTS,
    now: () => NOW,
    log: m => logs.push(m),
    // No real GitHub in tests: a check that says this version is the newest.
    updates: /** @type {any} */ ({ latest: () => null, enabled: () => true, setEnabled: () => {} }),
    publicDir: path.join(__dirname, '..', 'public'),
    ...extra,
  });
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', () => r(null)));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  test.after(() => server.close());

  /** @param {string} p @param {RequestInit & { cookie?: string }} [opts] */
  const req = (p, opts = {}) =>
    fetch(base + p, {
      redirect: 'manual',
      ...opts,
      headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), .../** @type {any} */ (opts.headers ?? {}) },
    });

  // Sign in as the account behind a pin, and return its session cookie (or the redirect location).
  /** @param {number} pin */
  const signIn = async pin => {
    const res = await req('/auth/plex/callback', { cookie: `mr_pin=${pin}` });
    const set = res.headers.getSetCookie().find(c => c.startsWith('mr_session=') && !c.startsWith('mr_session=;'));
    return { location: res.headers.get('location'), cookie: set ? set.split(';')[0] : '' };
  };
  /** @param {string} cookie @param {string} p */
  const post = (cookie, p) =>
    req(p, { method: 'POST', cookie, headers: { 'content-type': 'application/json' }, body: '{}' });

  return { store, req, signIn, post, logs };
}

test('sign-in starts at plex.tv and comes back to the callback', async () => {
  const { req } = await setup();
  const res = await req('/auth/plex', { headers: { 'x-forwarded-host': 'review.example' } });
  assert.equal(res.status, 303);
  assert.match(
    String(res.headers.get('location')),
    /^https:\/\/app\.plex\.tv\/auth#\?code=CODE&forwardUrl=http:\/\/review\.example\/auth\/plex\/callback$/,
  );
  assert.match(String(res.headers.getSetCookie()[0]), /^mr_pin=2; .*HttpOnly; SameSite=Lax/);
});

test('an account the server is not shared with cannot sign in', async () => {
  const { signIn, store } = await setup();
  const r = await signIn(4);
  assert.equal(r.location, '/?signin=no-access');
  assert.equal(r.cookie, '');
  assert.equal(store.voter('x'), undefined);
});

test('a shared account signs in as a Voter, and the Owner is not a Voter', async () => {
  const { signIn, req, store } = await setup();
  const alice = await signIn(2);
  assert.equal(alice.location, '/');
  assert.deepEqual(await (await req('/api/me', { cookie: alice.cookie })).json(), {
    plexId: 'a',
    username: 'alice',
    isOwner: false,
    sampleMinutes: { movie: 30, show: 10, anime: 10 },
  });
  const owner = await signIn(1);
  assert.equal((await (await req('/api/me', { cookie: owner.cookie })).json()).isOwner, true);
  assert.equal(store.voter('owner'), undefined);
});

test('Voters Downvote once, see only their own Downvotes, and the Owner cannot Downvote', async () => {
  const { signIn, req, post } = await setup();
  const alice = (await signIn(2)).cookie;
  const bob = (await signIn(3)).cookie;
  const owner = (await signIn(1)).cookie;

  assert.equal((await post(alice, '/api/titles/m1/downvote')).status, 201);
  assert.equal((await post(alice, '/api/titles/m1/downvote')).status, 409);
  assert.equal((await post(alice, '/api/titles/nope/downvote')).status, 404);
  assert.equal((await post(owner, '/api/titles/m1/downvote')).status, 403);

  const titlesFor = async (/** @type {string} */ c) =>
    (await (await req('/api/titles', { cookie: c })).json()).titles[0];
  assert.equal((await titlesFor(alice)).downvoted, true);
  assert.equal((await titlesFor(bob)).downvoted, false);
});

test('writes need a JSON body (CSRF) and a session', async () => {
  const { signIn, req } = await setup();
  const alice = (await signIn(2)).cookie;
  const form = await req('/api/titles/m1/downvote', {
    method: 'POST',
    cookie: alice,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'x=1',
  });
  assert.equal(form.status, 415);
  assert.equal((await req('/api/titles')).status, 401);
});

test('only the Owner can see or make the API key', async () => {
  const { signIn, req, post } = await setup();
  const alice = (await signIn(2)).cookie;
  const owner = (await signIn(1)).cookie;
  assert.equal((await req('/api/owner/api-key', { cookie: alice })).status, 403);
  assert.equal((await post(alice, '/api/owner/api-key')).status, 403);
  assert.deepEqual(await (await req('/api/owner/api-key', { cookie: owner })).json(), { apiKey: null });
  const { apiKey } = await (await post(owner, '/api/owner/api-key')).json();
  assert.match(apiKey, /^[0-9a-f]{48}$/);
});

test('Media Ops reads the Review Queue with the API key, and nothing without it', async () => {
  const { signIn, req, post, store } = await setup();
  const owner = (await signIn(1)).cookie;
  const voters = [(await signIn(2)).cookie, (await signIn(3)).cookie, (await signIn(5)).cookie];
  store.upsertPlays(
    ['a', 'b', 'c'].map((v, i) => ({
      id: String(i),
      voterId: v,
      titleKey: 'm1',
      started: NOW - 60,
      seconds: 3600,
      watched: true,
    })),
  );

  assert.equal((await req('/api/v1/review-queue')).status, 401); // no key has been made yet
  const { apiKey } = await (await post(owner, '/api/owner/api-key')).json();
  assert.equal((await req('/api/v1/review-queue', { headers: { 'x-api-key': 'wrong' } })).status, 401);

  const key = { 'x-api-key': apiKey };
  assert.equal((await (await req('/api/v1/status', { headers: key })).json()).app, 'media-review');
  assert.equal((await req('/api/v1/health')).status, 401);
  assert.deepEqual(await (await req('/api/v1/health', { headers: key })).json(), [], "what's wrong: nothing");
  await post(voters[0], '/api/titles/m1/downvote');
  assert.deepEqual((await (await req('/api/v1/review-queue', { headers: key })).json()).reviewQueue, []);
  await post(voters[1], '/api/titles/m1/downvote');

  const { reviewQueue } = await (await req('/api/v1/review-queue', { headers: key })).json();
  assert.equal(reviewQueue.length, 1);
  assert.equal(reviewQueue[0].title.name, 'Dull Movie');
  assert.deepEqual(
    reviewQueue[0].downvotes.map((/** @type {any} */ d) => d.voter),
    ['alice', 'bob'],
  );
  // A Voter now sees it as with the Owner, and can't add to it.
  assert.equal((await (await req('/api/titles', { cookie: voters[2] })).json()).titles[0].inReview, true);
  assert.equal((await post(voters[2], '/api/titles/m1/downvote')).status, 409);
});

test('the web app and its files are served, and nothing outside public/', async () => {
  const { req } = await setup();
  const home = await req('/');
  assert.equal(home.status, 200);
  assert.match(String(home.headers.get('content-security-policy')), /default-src 'self'/);
  assert.equal((await req('/app.js')).status, 200);
  assert.equal((await req('/../package.json')).status, 404);
  assert.equal((await req('/%2e%2e/package.json')).status, 404);
});

test('Media Ops gets posters through the API key, not a Plex token', async () => {
  const { req, signIn, post } = await setup();
  const owner = (await signIn(1)).cookie;
  const { apiKey } = await (await post(owner, '/api/owner/api-key')).json();
  assert.equal((await req('/api/v1/poster/m1')).status, 401);
  const res = await req('/api/v1/poster/m1', { headers: { 'x-api-key': apiKey } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(await res.text(), 'img');
});

test('a Voter who has not Sampled a Title is told their Downvote will not count until they do', async () => {
  const { signIn, req, post, store } = await setup();
  const alice = (await signIn(2)).cookie;
  const title = async () => (await (await req('/api/titles', { cookie: alice })).json()).titles[0];

  assert.equal((await title()).sampled, false);
  assert.deepEqual(await (await post(alice, '/api/titles/m1/downvote')).json(), { downvoted: true, counts: false });

  store.upsertPlays([{ id: 'p', voterId: 'a', titleKey: 'm1', started: NOW - 60, seconds: 30 * 60, watched: false }]);
  assert.equal((await title()).sampled, true);
});

test('with PUBLIC_URL, sign-in returns to the public address and cookies are Secure', async () => {
  const { req, signIn } = await setup({ publicUrl: 'https://review.example.com/' });
  const res = await req('/auth/plex');
  assert.match(String(res.headers.get('location')), /forwardUrl=https:\/\/review\.example\.com\/auth\/plex\/callback$/);
  assert.match(String(res.headers.getSetCookie()[0]), /; Secure$/);
  const r = await signIn(2);
  assert.match(r.cookie, /^mr_session=/);
});

test('/healthz answers without a session', async () => {
  const { req } = await setup();
  const res = await req('/healthz');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});

test('a Voter withdraws a Downvote from the web app until the Title is queued', async () => {
  const { signIn, post } = await setup();
  const alice = (await signIn(2)).cookie;
  await post(alice, '/api/titles/m1/downvote');
  assert.equal((await post(alice, '/api/titles/m1/withdraw')).status, 200);
  const again = await post(alice, '/api/titles/m1/withdraw');
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { error: 'not-downvoted' });
});

test('Media Ops Keeps a queued Title with the API key', async () => {
  const { signIn, req, post, store } = await setup();
  const owner = (await signIn(1)).cookie;
  const voters = [(await signIn(2)).cookie, (await signIn(3)).cookie, (await signIn(5)).cookie];
  store.upsertPlays(
    ['a', 'b', 'c'].map((v, i) => ({
      id: String(i),
      voterId: v,
      titleKey: 'm1',
      started: NOW - 60,
      seconds: 3600,
      watched: true,
    })),
  );
  await post(voters[0], '/api/titles/m1/downvote');
  await post(voters[1], '/api/titles/m1/downvote');
  const { apiKey } = await (await post(owner, '/api/owner/api-key')).json();
  const keepIt = (/** @type {Record<string, string>} */ headers) =>
    req('/api/v1/review-queue/m1/keep', { method: 'POST', headers });

  assert.equal((await keepIt({})).status, 401);
  assert.deepEqual(await (await keepIt({ 'x-api-key': apiKey })).json(), { kept: true });
  assert.deepEqual(await (await keepIt({ 'x-api-key': apiKey })).json(), { error: 'not-queued' });
  // Back to zero: the Voters can Downvote it again.
  assert.equal((await (await req('/api/titles', { cookie: voters[0] })).json()).titles[0].downvoted, false);
  assert.equal((await post(voters[0], '/api/titles/m1/downvote')).status, 201);
});

test('Titles are grouped by their Plex library, so Voters can browse Movies, TV Shows and Anime apart', async () => {
  const { signIn, req, store } = await setup();
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie', library: 'Movies' },
    { ratingKey: 's1', kind: 'show', title: 'Slow Show', library: 'TV Shows' },
    { ratingKey: 'a1', kind: 'show', title: 'Loud Anime', library: 'Anime' },
    { ratingKey: 'a2', kind: 'show', title: 'Another Anime', library: 'Anime' },
  ]);
  const alice = (await signIn(2)).cookie;
  const get = async (/** @type {string} */ p) => (await req(p, { cookie: alice })).json();

  assert.deepEqual((await get('/api/libraries')).libraries, [
    { name: 'Movies', kind: 'movie', count: 1, key: null },
    { name: 'TV Shows', kind: 'show', count: 1, key: null },
    { name: 'Anime', kind: 'show', count: 2, key: null },
  ]);
  const anime = (await get('/api/titles?library=Anime')).titles;
  assert.deepEqual(
    anime.map((/** @type {any} */ t) => [t.title, t.library]),
    [
      ['Another Anime', 'Anime'],
      ['Loud Anime', 'Anime'],
    ],
  );
  assert.equal((await get('/api/titles')).titles.length, 4);
});

test('without Media Ops, the signed-in Owner sees the Review Queue and Keeps in Media Review', async () => {
  const { signIn, req, post, store } = await setup();
  const owner = (await signIn(1)).cookie;
  const voters = [(await signIn(2)).cookie, (await signIn(3)).cookie, (await signIn(5)).cookie];
  store.upsertPlays(
    ['a', 'b', 'c'].map((v, i) => ({
      id: String(i),
      voterId: v,
      titleKey: 'm1',
      started: NOW - 60,
      seconds: 3600,
      watched: true,
    })),
  );
  await post(voters[0], '/api/titles/m1/downvote');
  await post(voters[1], '/api/titles/m1/downvote');

  // No API key has ever been made: this is all through the Owner's session.
  assert.equal((await req('/api/owner/review-queue', { cookie: voters[0] })).status, 403);
  assert.equal((await post(voters[0], '/api/owner/review-queue/m1/keep')).status, 403);
  const { reviewQueue } = await (await req('/api/owner/review-queue', { cookie: owner })).json();
  assert.deepEqual(
    reviewQueue.map((/** @type {any} */ e) => [e.title.name, e.downvotes.map((/** @type {any} */ d) => d.voter)]),
    [['Dull Movie', ['alice', 'bob']]],
  );

  assert.deepEqual(await (await post(owner, '/api/owner/review-queue/m1/keep')).json(), { kept: true });
  assert.deepEqual(await (await post(owner, '/api/owner/review-queue/m1/keep')).json(), { error: 'not-queued' });
  assert.deepEqual((await (await req('/api/owner/review-queue', { cookie: owner })).json()).reviewQueue, []);
});

test('Remove and Keep after all, from Media Review and from Media Ops; Voters see the days left, not who', async () => {
  let changes = 0;
  const { signIn, req, post, store } = await setup({ leavingChanged: () => changes++ });
  const owner = (await signIn(1)).cookie;
  const voters = [(await signIn(2)).cookie, (await signIn(3)).cookie, (await signIn(5)).cookie];
  store.upsertPlays(
    ['a', 'b', 'c'].map((v, i) => ({
      id: String(i),
      voterId: v,
      titleKey: 'm1',
      started: NOW - 60,
      seconds: 3600,
      watched: true,
    })),
  );
  await post(voters[0], '/api/titles/m1/downvote');
  await post(voters[1], '/api/titles/m1/downvote');

  // Owner removes it in Media Review.
  assert.equal((await post(voters[0], '/api/owner/review-queue/m1/remove')).status, 403);
  const removed = await (await post(owner, '/api/owner/review-queue/m1/remove')).json();
  const ends = quietTime(NOW + 14 * 86400, 4);
  assert.deepEqual(removed, { removed: true, endsAt: new Date(ends * 1000).toISOString() });
  assert.equal(changes, 1);

  // Voters: the tile says 14 days, the Leaving Soon tab lists it, and nobody's name is in either.
  const tile = (await (await req('/api/titles', { cookie: voters[2] })).json()).titles[0];
  assert.equal(tile.leavingInDays, Math.ceil((ends - NOW) / 86400));
  const tab = (await (await req('/api/titles?leaving=1', { cookie: voters[2] })).json()).titles;
  assert.deepEqual(
    tab.map((/** @type {any} */ t) => t.title),
    ['Dull Movie'],
  );
  const list = await (await req('/api/leaving-soon', { cookie: voters[2] })).text();
  assert.match(list, /Dull Movie/);
  assert.doesNotMatch(list, /alice|bob/);
  const refused = await post(voters[2], '/api/titles/m1/downvote');
  assert.deepEqual([refused.status, await refused.json()], [409, { error: 'leaving' }]);

  // Media Ops sees the same Leaving Soon list, and Keeps it after all with the API key.
  const { apiKey } = await (await post(owner, '/api/owner/api-key')).json();
  const key = { 'x-api-key': apiKey };
  const viaOps = await (await req('/api/v1/leaving-soon', { headers: key })).json();
  assert.equal(viaOps.leavingSoon[0].daysLeft, Math.ceil((ends - NOW) / 86400));
  const queueKeep = await req('/api/v1/review-queue/m1/keep', { method: 'POST', headers: key });
  assert.deepEqual(await queueKeep.json(), { error: 'not-queued' });
  const keptAfterAll = await req('/api/v1/leaving-soon/m1/keep', { method: 'POST', headers: key });
  assert.deepEqual(await keptAfterAll.json(), { kept: true });
  assert.equal(changes, 2);
  assert.deepEqual((await (await req('/api/owner/leaving-soon', { cookie: owner })).json()).leavingSoon, []);
  const again = await post(owner, '/api/owner/leaving-soon/m1/keep');
  assert.deepEqual(await again.json(), { error: 'not-leaving' });
  assert.equal((await post(owner, '/api/owner/leaving-soon/m1/remove')).status, 404);
});

test('why a deletion failed is shown to the Owner and Media Ops, never to Voters', async () => {
  const { signIn, req, post, store } = await setup();
  const owner = (await signIn(1)).cookie;
  const alice = (await signIn(2)).cookie;
  store.remove('m1', NOW - 86400, NOW);
  store.deleteFailed('m1', 'not found in Radarr, so nothing was deleted', []);
  const { apiKey } = await (await post(owner, '/api/owner/api-key')).json();

  const forOwner = (await (await req('/api/owner/leaving-soon', { cookie: owner })).json()).leavingSoon[0];
  assert.equal(forOwner.deleteError, 'not found in Radarr, so nothing was deleted');
  const forOps = (await (await req('/api/v1/leaving-soon', { headers: { 'x-api-key': apiKey } })).json())
    .leavingSoon[0];
  assert.equal(forOps.deleteError, 'not found in Radarr, so nothing was deleted');
  const forAlice = (await (await req('/api/leaving-soon', { cookie: alice })).json()).leavingSoon[0];
  assert.equal('deleteError' in forAlice, false);
});

test('Objections from the web app: refused for downvoters, shown to the Owner, and one friend who tried it sends it back', async () => {
  let changes = 0;
  const { signIn, req, post, store } = await setup({ leavingChanged: () => changes++ });
  const owner = (await signIn(1)).cookie;
  const [alice, bob, carol] = [(await signIn(2)).cookie, (await signIn(3)).cookie, (await signIn(5)).cookie];
  store.upsertVoter({ plexId: 'd', username: 'dave' });
  const dave = (await signIn(6)).cookie;
  // alice, bob and carol watched it; dave never did.
  store.upsertPlays(
    ['a', 'b', 'c'].map((v, i) => ({
      id: String(i),
      voterId: v,
      titleKey: 'm1',
      started: NOW - 60,
      seconds: 3600,
      watched: true,
    })),
  );
  await post(alice, '/api/titles/m1/downvote');
  await post(bob, '/api/titles/m1/downvote');
  await post(owner, '/api/owner/review-queue/m1/remove');

  assert.deepEqual(await (await post(alice, '/api/titles/m1/object')).json(), { error: 'downvoted' });
  assert.equal((await post(owner, '/api/titles/m1/object')).status, 403);

  // dave's Objection weighs nothing (never tried it, no other watching): not sent back.
  assert.deepEqual(await (await post(dave, '/api/titles/m1/object')).json(), { objected: true, sentBack: false });
  const [forOwner] = (await (await req('/api/owner/leaving-soon', { cookie: owner })).json()).leavingSoon;
  assert.deepEqual(
    [forOwner.objections, forOwner.objectionWeight, forOwner.objectionBar],
    [[{ voter: 'dave', voteWeight: 0 }], 0, 2],
  );
  const forCarol = await (await req('/api/leaving-soon', { cookie: carol })).text();
  assert.doesNotMatch(forCarol, /dave/, 'Voters never see who objected');
  const tile = (await (await req('/api/titles', { cookie: dave })).json()).titles[0];
  assert.deepEqual([tile.objected, tile.objectionsOpen], [true, true]);
  assert.deepEqual(await (await post(dave, '/api/titles/m1/unobject')).json(), { objected: false });

  // carol watched it: her Objection alone reaches the bar.
  assert.deepEqual(await (await post(carol, '/api/titles/m1/object')).json(), { objected: true, sentBack: true });
  assert.equal(changes, 2, 'Remove, then the send-back: Plex is told both times');
  const [entry] = (await (await req('/api/owner/review-queue', { cookie: owner })).json()).reviewQueue;
  assert.equal(entry.sentBack, true);
  assert.deepEqual(entry.objections, [{ voter: 'carol', voteWeight: 3 }]);

  // Removed again: no Objections this time.
  await post(owner, '/api/owner/review-queue/m1/remove');
  assert.deepEqual(await (await post(dave, '/api/titles/m1/object')).json(), { error: 'objections-closed' });
  const again = (await (await req('/api/titles', { cookie: dave })).json()).titles[0];
  assert.equal(again.objectionsOpen, false);
});

test('Problem Reports from the web app: a Voter sees only their own, the Owner and Media Ops resolve or close', async () => {
  const { store, req, signIn, post } = await setup();
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie' },
    { ratingKey: 's1', kind: 'show', title: 'Slow Show' },
  ]);
  const [owner, alice, bob] = await Promise.all([1, 2, 3].map(async pin => (await signIn(pin)).cookie));
  /** @param {string} cookie @param {string} p @param {unknown} body */
  const send = (cookie, p, body) =>
    req(p, { method: 'POST', cookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  assert.deepEqual(await (await req('/api/titles/s1/episodes', { cookie: alice })).json(), {
    seasons: [
      {
        season: 1,
        episodes: [
          { episode: 1, title: 'Pilot' },
          { episode: 2, title: 'Two' },
        ],
      },
    ],
  });
  const filed = await send(alice, '/api/titles/s1/problems', {
    season: 1,
    episode: 2,
    reason: 'audio',
    note: 'no sound',
  });
  assert.equal(filed.status, 201);
  const { id } = await filed.json();
  assert.equal((await send(alice, '/api/titles/s1/problems', { season: 1, episode: 2, reason: 'audio' })).status, 409);
  assert.equal((await send(alice, '/api/titles/s1/problems', { season: 4, reason: 'audio' })).status, 400);
  assert.equal((await send(owner, '/api/titles/m1/problems', { reason: 'audio' })).status, 403);

  // bob sees there's one open, not whose, and says me too.
  const open = (await (await req('/api/titles/s1/problems', { cookie: bob })).json()).problemReports;
  assert.deepEqual([open[0].id, open[0].part, open[0].mine], [id, 'S1 E2 · Two', false]);
  assert.doesNotMatch(JSON.stringify(open), /alice|no sound/);
  assert.deepEqual(await (await send(bob, `/api/problems/${id}/me-too`, { note: 'same' })).json(), { ok: true });
  assert.deepEqual(
    (await (await req('/api/problems', { cookie: bob })).json()).problemReports.map((/** @type {any} */ r) => r.note),
    ['same'],
  );
  assert.equal(store.downvotesOf('s1').length, 0, 'never a Downvote');

  // Media Ops sees who has it, and resolves it with a note.
  const { apiKey } = await (await post(owner, '/api/owner/api-key')).json();
  const key = { 'x-api-key': apiKey, 'content-type': 'application/json' };
  assert.equal((await req('/api/v1/problem-reports')).status, 401);
  const [forOps] = (await (await req('/api/v1/problem-reports', { headers: key })).json()).problemReports;
  assert.deepEqual(
    forOps.reporters.map((/** @type {any} */ r) => [r.voter, r.note]),
    [
      ['alice', 'no sound'],
      ['bob', 'same'],
    ],
  );
  assert.equal((await post(alice, `/api/owner/problem-reports/${id}/resolve`)).status, 403);
  const resolve = () =>
    req(`/api/v1/problem-reports/${id}/resolve`, { method: 'POST', headers: key, body: '{"note":"Replaced"}' });
  assert.deepEqual(await (await resolve()).json(), { resolved: true });
  assert.deepEqual(await (await resolve()).json(), { error: 'not-open' });
  assert.deepEqual((await (await req('/api/owner/problem-reports', { cookie: owner })).json()).problemReports, []);
  const [mine] = (await (await req('/api/problems', { cookie: alice })).json()).problemReports;
  assert.deepEqual([mine.outcome, mine.ownerNote], ['resolved', 'Replaced']);

  // And closing, from the Owner's own page.
  const two = await (await send(bob, '/api/titles/m1/problems', { reason: 'other', note: 'wrong cut' })).json();
  assert.deepEqual(await (await post(owner, `/api/owner/problem-reports/${two.id}/close`)).json(), { closed: true });
  assert.equal((await (await req('/api/problems', { cookie: bob })).json()).problemReports[0].outcome, 'closed');
  assert.equal((await (await req('/api/problems', { cookie: alice })).json()).problemReports.length, 1);
});

test('Gone from the web app: friends ask to bring it back, the Owner and Media Ops bring back or decline', async () => {
  const calls = /** @type {string[]} */ ([]);
  const fakeSeerr = /** @type {any} */ ({
    block: async (/** @type {any} */ m) => void calls.push(`block ${m.mediaType}:${m.tmdbId}`),
    unblock: async (/** @type {any} */ m) => void calls.push(`unblock ${m.mediaType}:${m.tmdbId}`),
    request: async (/** @type {any} */ m) => void calls.push(`request ${m.mediaType}:${m.tmdbId}`),
  });
  const { store, req, signIn, post } = await setup({ seerr: () => fakeSeerr });
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie', tmdbId: '603' },
    { ratingKey: 'm2', kind: 'movie', title: 'Other', tmdbId: '604' },
  ]);
  for (const key of ['m1', 'm2']) {
    store.remove(key, NOW - 20 * 86400, NOW - 86400);
    store.deleted(key, NOW - 86400, ['Radarr']);
  }
  const [owner, alice, bob] = await Promise.all([1, 2, 3].map(async pin => (await signIn(pin)).cookie));
  /** @param {string} cookie @param {string} p @param {unknown} body */
  const send = (cookie, p, body) =>
    req(p, { method: 'POST', cookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const gone = (await (await req('/api/gone', { cookie: alice })).json()).gone;
  assert.deepEqual(gone.map((/** @type {any} */ g) => [g.title, g.asked]).sort(), [
    ['Dull Movie', false],
    ['Other', false],
  ]);
  assert.deepEqual(await (await send(alice, '/api/gone/m1/ask', { note: 'please' })).json(), { asked: true });
  assert.deepEqual(await (await send(alice, '/api/gone/m1/ask', {})).json(), { error: 'already-asked' });
  assert.equal((await send(owner, '/api/gone/m1/ask', {})).status, 403);
  await send(bob, '/api/gone/m2/ask', {});
  assert.doesNotMatch(JSON.stringify((await (await req('/api/gone', { cookie: bob })).json()).gone), /alice|please/);

  // The Owner sees who asked, with the history; Voters can't.
  assert.equal((await req('/api/owner/held-back', { cookie: alice })).status, 403);
  const list = (await (await req('/api/owner/held-back', { cookie: owner })).json()).heldBack;
  assert.deepEqual(
    list[0].asks.map((/** @type {any} */ a) => [a.voter, a.note]),
    [['alice', 'please']],
  );
  assert.deepEqual(
    list[0].history.decisions.map((/** @type {any} */ d) => d.decision),
    ['remove'],
  );

  // Media Ops brings m1 back; the Owner declines m2.
  const { apiKey } = await (await post(owner, '/api/owner/api-key')).json();
  const key = { 'x-api-key': apiKey, 'content-type': 'application/json' };
  const back = await req('/api/v1/held-back/m1/bring-back', {
    method: 'POST',
    headers: key,
    body: '{"note":"Back tonight"}',
  });
  assert.deepEqual(await back.json(), { broughtBack: true });
  assert.deepEqual(calls, ['unblock movie:603', 'request movie:603']);
  assert.deepEqual(await (await send(owner, '/api/owner/held-back/m2/decline', { note: 'no' })).json(), {
    declined: true,
  });
  assert.deepEqual(await (await send(owner, '/api/owner/held-back/m1/decline', {})).json(), { error: 'not-gone' });

  const [mine] = (await (await req('/api/asks', { cookie: alice })).json()).asks;
  assert.deepEqual([mine.title, mine.outcome, mine.ownerNote], ['Dull Movie', 'brought-back', 'Back tonight']);
  const [bobs] = (await (await req('/api/asks', { cookie: bob })).json()).asks;
  assert.deepEqual([bobs.outcome, bobs.ownerNote], ['declined', 'no']);
});

test("Connecting Discord: the bot's one-time link connects the signed-in Plex account, once", async () => {
  const { store, req, signIn, post } = await setup();
  const [alice, bob] = await Promise.all([2, 3].map(async pin => (await signIn(pin)).cookie));
  store.addLinkToken('tok-for-alice-0001', 'd-alice', 'alice#1', NOW - 60);
  store.addLinkToken('tok-too-old-000001', 'd-old', null, NOW - 31 * 60);

  assert.equal((await req('/api/discord/link/tok-for-alice-0001')).status, 401, 'signed in only');
  assert.deepEqual(await (await req('/api/discord/link/tok-for-alice-0001', { cookie: alice })).json(), {
    discordName: 'alice#1',
  });
  assert.equal((await req('/api/discord/link/tok-too-old-000001', { cookie: alice })).status, 404, 'expired');
  assert.deepEqual(await (await post(alice, '/api/discord/link/tok-for-alice-0001')).json(), {
    linked: true,
    discordName: 'alice#1',
  });
  assert.equal(store.linkOf('d-alice')?.plex_id, 'a');
  assert.equal((await post(bob, '/api/discord/link/tok-for-alice-0001')).status, 404, 'used up');

  const mine = await (await req('/api/discord', { cookie: alice })).json();
  assert.equal(mine.linked.name, 'alice#1');
  assert.equal(mine.reminders, true, 'Leaving Soon DMs: on unless they turn them off');
  const turn = (/** @type {boolean} */ on) =>
    req('/api/discord/reminders', {
      method: 'PUT',
      cookie: alice,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on }),
    });
  assert.deepEqual(await (await turn(false)).json(), { reminders: false });
  assert.equal(store.voter('a')?.reminders, 0);
  assert.equal((await (await req('/api/discord', { cookie: alice })).json()).reminders, false);
  assert.equal((await (await req('/api/discord', { cookie: bob })).json()).linked, null);
  assert.deepEqual(await (await post(alice, '/api/discord/unlink')).json(), { unlinked: true });
  assert.equal(store.linkOf('d-alice'), undefined);
});

test('every Owner and Media Ops route answers once: nothing logs a second answer', async () => {
  const { req, signIn, post, logs } = await setup();
  const owner = (await signIn(1)).cookie;
  const { apiKey } = await (await post(owner, '/api/owner/api-key')).json();
  for (const p of ['/review-queue', '/leaving-soon', '/problem-reports', '/held-back']) {
    assert.equal((await req(`/api/v1${p}`, { headers: { 'x-api-key': apiKey } })).status, 200);
    assert.equal((await req(`/api/owner${p}`, { cookie: owner })).status, 200);
  }
  assert.equal((await req('/api/owner/rules', { cookie: owner })).status, 200);
  assert.deepEqual(
    logs.filter(m => /failed/.test(m)),
    [],
  );
});

test('an announced poster is fetched by its signed link without signing in; nothing else is', async () => {
  const { store, req } = await setup();
  const { posterSig } = require('../lib/notices');
  const ok = await req(`/cover/m1/${posterSig(store, 'm1')}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  assert.equal((await req(`/cover/m1/${'x'.repeat(22)}`)).status, 404);
  assert.equal((await req(`/cover/m2/${posterSig(store, 'm1')}`)).status, 404);
  assert.equal((await req('/poster/m1')).status, 401, 'the normal poster still needs a session');
});

test("a friend clears finished reports and answered asks from their own list; open ones stay, nobody else's change", async () => {
  const { store, req, signIn, post } = await setup();
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie', tmdbId: '1' },
    { ratingKey: 'm2', kind: 'movie', title: 'Other', tmdbId: '2' },
  ]);
  const [owner, alice, bob] = await Promise.all([1, 2, 3].map(async pin => (await signIn(pin)).cookie));
  /** @param {string} cookie @param {string} p @param {unknown} body */
  const send = (cookie, p, body) =>
    req(p, { method: 'POST', cookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const done = await (await send(alice, '/api/titles/m1/problems', { reason: 'audio' })).json();
  const open = await (await send(alice, '/api/titles/m2/problems', { reason: 'video' })).json();
  await post(bob, `/api/problems/${done.id}/me-too`);
  await post(owner, `/api/owner/problem-reports/${done.id}/resolve`);
  /** @param {string} cookie */
  const mine = async cookie =>
    (await (await req('/api/problems', { cookie })).json()).problemReports.map((/** @type {any} */ r) => r.id);

  assert.deepEqual(await (await post(alice, `/api/problems/${open.id}/dismiss`)).json(), { error: 'not-finished' });
  assert.deepEqual(await (await post(alice, `/api/problems/${done.id}/dismiss`)).json(), { cleared: 1 });
  assert.deepEqual(await mine(alice), [open.id], 'the open one stays');
  assert.deepEqual(await mine(bob), [done.id], "bob's list is his own");
  assert.equal((await (await req('/api/owner/problem-reports', { cookie: owner })).json()).problemReports.length, 1);
  assert.deepEqual(await (await post(bob, '/api/problems/dismiss-finished')).json(), { cleared: 1 });
  assert.deepEqual(await mine(bob), []);

  // Asks to bring back, the same way.
  store.remove('m2', NOW - 20 * 86400, NOW - 86400);
  store.deleted('m2', NOW - 86400, ['Radarr']);
  await send(alice, '/api/gone/m2/ask', {});
  const [ask] = (await (await req('/api/asks', { cookie: alice })).json()).asks;
  assert.deepEqual(await (await post(alice, `/api/asks/${ask.id}/dismiss`)).json(), { error: 'not-finished' });
  await send(owner, '/api/owner/held-back/m2/decline', { note: 'no' });
  assert.deepEqual(await (await post(alice, '/api/asks/dismiss-finished')).json(), { cleared: 1 });
  assert.deepEqual((await (await req('/api/asks', { cookie: alice })).json()).asks, []);
});

test('Building up: the Owner and Media Ops see it and can Keep or Remove now; Voters cannot', async () => {
  const { store, req, signIn, post } = await setup();
  const [owner, alice] = await Promise.all([1, 2].map(async pin => (await signIn(pin)).cookie));
  await post(alice, '/api/titles/m1/downvote');
  assert.equal((await req('/api/owner/building-up', { cookie: alice })).status, 403);
  const [entry] = (await (await req('/api/owner/building-up', { cookie: owner })).json()).buildingUp;
  assert.deepEqual(
    [entry.title.name, entry.downvotes.map((/** @type {any} */ d) => d.voter)],
    ['Dull Movie', ['alice']],
  );
  const { apiKey } = await (await post(owner, '/api/owner/api-key')).json();
  const key = { 'x-api-key': apiKey };
  assert.equal((await (await req('/api/v1/building-up', { headers: key })).json()).buildingUp.length, 1);
  const removed = await (await req('/api/v1/building-up/m1/remove', { method: 'POST', headers: key })).json();
  assert.equal(removed.removed, true);
  assert.ok(store.isLeaving('m1'));
  assert.deepEqual(await (await post(owner, '/api/owner/building-up/m1/keep')).json(), { error: 'not-building-up' });
});

test('Appearance: the Owner sets theme, accent, title and logo; every page is sent with them', async () => {
  const { req, signIn } = await setup();
  const [owner, alice] = await Promise.all([1, 2].map(async pin => (await signIn(pin)).cookie));
  /** @param {string} cookie @param {string} method @param {string} p @param {unknown} body */
  const send = (cookie, method, p, body) =>
    req(p, { method, cookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const before = await (await req('/')).text();
  assert.match(before, /<html lang="en">/, 'the default look adds nothing');
  assert.equal((await req('/api/owner/appearance', { cookie: alice })).status, 403);
  const form = await (await req('/api/owner/appearance', { cookie: owner })).json();
  assert.deepEqual(
    [form.theme, form.accent, form.title, form.logo, form.accents.length],
    ['auto', 'amber', '', null, 6],
  );

  assert.equal((await send(owner, 'PUT', '/api/owner/appearance', { title: '<b>x</b>' })).status, 400);
  const saved = await (
    await send(owner, 'PUT', '/api/owner/appearance', {
      theme: 'light',
      accent: 'teal',
      title: 'Kaiser Review',
      extra: 1,
    })
  ).json();
  assert.deepEqual([saved.theme, saved.accent, saved.title], ['light', 'teal', 'Kaiser Review']);
  const page = await (await req('/review.html')).text();
  assert.match(page, /<html lang="en" data-theme="light" data-accent="teal">/);
  assert.match(page, /<title>Kaiser Review · Review Queue<\/title>/);
  assert.match(page, /<h1>Kaiser Review<\/h1>/);

  // A logo: real image bytes only, served to anyone, by a link that changes with it.
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  assert.match(
    (
      await (
        await send(owner, 'POST', '/api/owner/appearance/logo', { data: Buffer.from('<svg/>').toString('base64') })
      ).json()
    ).error,
    /PNG, JPEG or WebP/,
  );
  const withLogo = await (await send(owner, 'POST', '/api/owner/appearance/logo', { data: png })).json();
  assert.match(withLogo.logo.hash, /^[0-9a-f]{16}$/);
  assert.match(
    await (await req('/')).text(),
    new RegExp(`<img class="logo custom" src="/branding/logo\\?v=${withLogo.logo.hash}"`),
  );
  const logo = await req('/branding/logo');
  assert.equal(logo.headers.get('content-type'), 'image/png');
  await send(owner, 'DELETE', '/api/owner/appearance/logo', {});
  assert.equal((await req('/branding/logo')).status, 404);
});

test('Status, Sync now and Diagnostics: Owner only; the report leaves out addresses and names', async () => {
  const { store, req, signIn, post } = await setup();
  const [owner, alice] = await Promise.all([1, 2].map(async pin => (await signIn(pin)).cookie));
  const { jobStatus } = require('../lib/status');
  jobStatus(store).record('sync', {
    at: NOW - 120,
    ok: false,
    error: "play history: couldn't reach Tautulli (connect ECONNREFUSED 192.168.1.20:8181)",
    steps: [
      { name: 'titles', ok: true, error: null, count: 1234 },
      { name: 'play history', ok: false, error: 'connect ECONNREFUSED 192.168.1.20:8181', count: null },
    ],
  });
  jobStatus(store).record('access', { at: NOW - 100, ok: true, error: null, removed: ['alice'], restored: [] });
  assert.equal((await req('/api/owner/status', { cookie: alice })).status, 403);
  const st = await (await req('/api/owner/status', { cookie: owner })).json();
  assert.deepEqual([st.jobs.sync.ok, st.jobs.sync.steps[0].count, st.now], [false, 1234, NOW]);
  assert.equal((await post(alice, '/api/owner/diagnostics')).status, 403);
  const d = await (await post(owner, '/api/owner/diagnostics')).json();
  assert.ok(Array.isArray(d.checks) && d.checks[0].name === 'Plex');
  assert.match(d.report, /^Media Review \d+\.\d+\.\d+ · Node v/);
  assert.match(d.report, /- sync: FAILED: .* 2 min ago \(titles 1234, play history failed\)/);
  assert.match(d.report, /- access: ok, 2 min ago \(1 signed out, 0 back\)/);
  assert.doesNotMatch(d.report, /192\.168|alice/, 'no IP addresses, no names');
});

test('Status says which version this is and whether a newer one is out; the Owner can turn checking off', async () => {
  let on = true;
  const fakeUpdates = /** @type {any} */ ({
    latest: () => (on ? { version: '9.9.9', url: 'https://example.invalid/r' } : null),
    enabled: () => on,
    setEnabled: (/** @type {boolean} */ v) => (on = v),
  });
  const { req, signIn } = await setup(/** @type {any} */ ({ updates: fakeUpdates }));
  const owner = (await signIn(1)).cookie;
  const st = await (await req('/api/owner/status', { cookie: owner })).json();
  assert.match(st.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual([st.update.version, st.checkUpdates], ['9.9.9', true]);
  const off = await (
    await req('/api/owner/check-updates', {
      method: 'PUT',
      cookie: owner,
      headers: { 'content-type': 'application/json' },
      body: '{"on":false}',
    })
  ).json();
  assert.deepEqual([off.update, off.checkUpdates], [null, false]);
});

test('Download backup: the Owner gets a copy of the database; nobody else does', async () => {
  const { req, signIn, logs } = await setup();
  const [owner, alice] = await Promise.all([1, 2].map(async pin => (await signIn(pin)).cookie));
  assert.equal((await req('/api/owner/backup', { cookie: alice })).status, 403);
  const res = await req('/api/owner/backup', { cookie: owner });
  assert.equal(res.status, 200);
  assert.match(
    String(res.headers.get('content-disposition')),
    /^attachment; filename="media-review-\d{4}-\d{2}-\d{2}\.db"$/,
  );
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(body.subarray(0, 15).toString(), 'SQLite format 3');
  assert.ok(logs.includes('Backup downloaded (Settings)'));
});

test('Title history: the Owner searches any Title and gets its story; nobody else can', async () => {
  const { req, signIn, store } = await setup();
  const [owner, alice] = await Promise.all([1, 2].map(async pin => (await signIn(pin)).cookie));
  store.addDownvote('a', 'm1', NOW - 60);
  assert.equal((await req('/api/owner/titles?q=dull', { cookie: alice })).status, 403);
  assert.deepEqual(
    (await (await req('/api/owner/titles?q=d', { cookie: owner })).json()).titles,
    [],
    'two letters at least',
  );
  const { titles } = await (await req('/api/owner/titles?q=dull', { cookie: owner })).json();
  assert.deepEqual(titles, [
    { ratingKey: 'm1', name: 'Dull Movie', year: 2020, kind: 'movie', library: null, inPlex: true },
  ]);
  const h = await (await req('/api/owner/titles/m1/history', { cookie: owner })).json();
  assert.equal(h.title.poster, '/poster/m1');
  assert.deepEqual(
    h.events.map((/** @type {any} */ e) => e.text),
    ['Downvoted by alice'],
  );
  assert.equal((await req('/api/owner/titles/nope/history', { cookie: owner })).status, 404);
});
