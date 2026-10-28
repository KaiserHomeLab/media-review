// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openStore } = require('../lib/store');
const { DEFAULTS } = require('../lib/rules');
const { createApp } = require('../lib/web');

const NOW = 1_800_000_000;

// Plex with three accounts: the Owner, a shared Voter per pin, and a stranger.
const ACCOUNTS =
  /** @type {Record<number, { plexId: string, username: string, access: 'owner' | 'shared' | 'none' }>} */ ({
    1: { plexId: 'owner', username: 'Owner', access: 'owner' },
    2: { plexId: 'a', username: 'alice', access: 'shared' },
    3: { plexId: 'b', username: 'bob', access: 'shared' },
    4: { plexId: 'x', username: 'stranger', access: 'none' },
    5: { plexId: 'c', username: 'carol', access: 'shared' },
  });
const fakePlex = /** @type {any} */ ({
  createPin: async () => ({ id: 2, code: 'CODE' }),
  authUrl: (/** @type {string} */ code, /** @type {string} */ fwd) =>
    `https://app.plex.tv/auth#?code=${code}&forwardUrl=${fwd}`,
  pinToken: async (/** @type {number} */ id) => (ACCOUNTS[id] ? `token-${id}` : null),
  account: async (/** @type {string} */ token) => ({ ...ACCOUNTS[Number(token.slice(6))], thumb: null }),
  poster: async () => new Response('img', { headers: { 'content-type': 'image/jpeg' } }),
});

/** @param {{ publicUrl?: string }} [extra] */
async function setup(extra = {}) {
  const store = openStore(':memory:');
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie', year: 2020, thumb: '/library/m1/thumb' },
  ]);
  const app = createApp({
    store,
    plex: fakePlex,
    machineId: async () => 'machine',
    settings: DEFAULTS,
    now: () => NOW,
    log: () => {},
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

  return { store, req, signIn, post };
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
    sampleMinutes: { movie: 30, show: 10 },
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
