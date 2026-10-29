// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { openStore } = require('../lib/store');
const { createApp } = require('../lib/web');
const { appSettings } = require('../lib/apps');
const { ruleSettings } = require('../lib/rule-settings');
const { castDownvote, reviewQueue } = require('../lib/review');

const NOW = 1_800_000_000;
const CODE = 'K7QF-2M9X';

// plex.tv: pin 1 is the Owner (owns "Tower"), pin 2 a friend who owns no server.
const fakePlex = /** @type {any} */ ({
  createPin: async () => ({ id: 1, code: 'CODE' }),
  authUrl: () => 'https://app.plex.tv/auth#?code=CODE',
  pinToken: async (/** @type {number} */ id) => `token-${id}`,
  account: async (/** @type {string} */ token) =>
    token === 'token-1'
      ? { plexId: 'owner', username: 'Owner', access: 'owner', thumb: null }
      : { plexId: 'friend', username: 'friend', access: 'shared', thumb: null },
  ownedServers: async (/** @type {string} */ token) =>
    token === 'token-1'
      ? [{ machineId: 'tower-id', name: 'Tower', addresses: [{ url: 'http://192.168.1.10:32400', local: true }] }]
      : [],
});

/** @type {string[]} the Discord API paths asked for */
const discordCalls = [];
// What answers at each address: Plex's /identity, by host.
/** @type {typeof fetch} */
const fakeFetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'discord.com') discordCalls.push(u.pathname);
  // Discord's API, for the bot token: the bot, and the servers it's in.
  if (u.hostname === 'discord.com') {
    if (/** @type {any} */ (init.headers)?.Authorization !== 'Bot good-token') return new Response('', { status: 401 });
    if (u.pathname === '/api/v10/users/@me') return Response.json({ id: 'b1', username: 'Media Review' });
    if (u.pathname === '/api/v10/users/@me/guilds') return Response.json([{ id: 'g1', name: 'Home Lab' }]);
    if (u.pathname === '/api/v10/guilds/g1/channels')
      return Response.json([
        { id: 'c2', name: 'owner-only', type: 0, position: 2 },
        { id: 'v1', name: 'Voice', type: 2, position: 0 },
        { id: 'c1', name: 'announcements', type: 5, position: 1 },
      ]);
  }
  if (u.pathname !== '/identity') return new Response('', { status: 404 });
  if (u.hostname === 'plex') return new Response(JSON.stringify({ MediaContainer: { machineIdentifier: 'tower-id' } }));
  if (u.hostname === 'other') return new Response(JSON.stringify({ MediaContainer: { machineIdentifier: 'not-it' } }));
  throw new Error('connect ECONNREFUSED');
};

/** @param {{ setUp?: boolean }} [opts] */
async function setup(opts = {}) {
  const store = openStore(':memory:');
  const apps = appSettings(store);
  if (opts.setUp) apps.setPlex({ url: 'http://plex:32400', token: 'token-1', machineId: 'tower-id', name: 'Tower' });
  let code = /** @type {string | null} */ (opts.setUp ? null : CODE);
  let changes = 0;
  const probes = /** @type {any[]} */ ([]);
  const rules = ruleSettings(store);
  const app = createApp({
    store,
    apps,
    rules,
    plex: fakePlex,
    machineId: async () => apps.read().plex?.machineId ?? '',
    settings: rules.values,
    now: () => NOW,
    log: () => {},
    publicDir: path.join(__dirname, '..', 'public'),
    setupCode: () => code,
    setupDone: () => (code = null),
    appsChanged: () => changes++,
    probe: async (id, cfg) => {
      probes.push({ id, ...cfg });
      if (cfg.apiKey === 'bad') throw new Error('Radarr answered HTTP 401');
      return '5.14.0';
    },
    fetch: fakeFetch,
  });
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', () => r(null)));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  test.after(() => server.close());

  // A tiny browser: keeps cookies, doesn't follow redirects.
  let jar = /** @type {Record<string, string>} */ ({});
  /** @param {string} p @param {{ method?: string, body?: unknown }} [o] */
  const req = async (p, o = {}) => {
    const res = await fetch(base + p, {
      method: o.method ?? 'GET',
      redirect: 'manual',
      headers: {
        cookie: Object.entries(jar)
          .map(([k, v]) => `${k}=${v}`)
          .join('; '),
        ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      if (v) jar[k] = v;
      else delete jar[k];
    }
    return res;
  };
  const body = async (/** @type {Response} */ r) => [r.status, await r.json()];
  // Sign in through plex.tv as the account behind a pin (callback with that pin).
  /** @param {number} pin */
  const plexSignIn = async pin => {
    await req('/auth/plex');
    jar.mr_pin = String(pin);
    return req('/auth/plex/callback');
  };
  return {
    store,
    apps,
    rules,
    req,
    body,
    plexSignIn,
    probes,
    changes: () => changes,
    code: () => code,
    reset: () => (jar = {}),
  };
}

// ------------------------------------------------------------------ first setup

test('a fresh install sends sign-in to setup, and setup starts with the code from the log', async () => {
  const s = await setup();
  assert.deepEqual(await s.body(await s.req('/api/setup')), [200, { setUp: false, step: 'code' }]);
  assert.equal((await s.req('/auth/plex')).headers.get('location'), '/setup.html');
  assert.equal((await s.req('/setup.html')).status, 200);
  assert.deepEqual(await s.body(await s.req('/api/setup/servers')), [
    403,
    { error: 'enter the setup code and sign in with Plex first' },
  ]);
});

test('a wrong setup code is refused, and ten close setup until a restart', async () => {
  const s = await setup();
  assert.deepEqual(await s.body(await s.req('/api/setup/code', { method: 'POST', body: { code: 'NOPE-NOPE' } })), [
    403,
    { error: 'wrong code' },
  ]);
  for (let i = 0; i < 9; i++) await s.req('/api/setup/code', { method: 'POST', body: { code: 'nope' } });
  const [status] = await s.body(await s.req('/api/setup/code', { method: 'POST', body: { code: CODE } }));
  assert.equal(status, 429, 'even the right code, after ten wrong ones');
});

test('code, Plex sign-in, pick the server: Plex is linked and the Owner is signed in', async () => {
  const s = await setup();
  // The code is forgiving about case and the dash.
  assert.equal((await s.req('/api/setup/code', { method: 'POST', body: { code: ' k7qf2m9x ' } })).status, 200);
  assert.equal((await s.body(await s.req('/api/setup')))[1].step, 'signin');

  assert.equal((await s.plexSignIn(1)).headers.get('location'), '/setup.html');
  assert.equal((await s.body(await s.req('/api/setup')))[1].step, 'server');
  const [, { servers }] = await s.body(await s.req('/api/setup/servers'));
  assert.deepEqual(
    servers.map((/** @type {any} */ x) => x.name),
    ['Tower'],
  );

  // The address must reach this very server.
  const pick = (/** @type {string} */ url) =>
    s.req('/api/setup/plex', { method: 'POST', body: { machineId: 'tower-id', url } });
  assert.deepEqual(await s.body(await pick('ftp://plex')), [400, { error: 'that is not an http(s) address' }]);
  assert.deepEqual(await s.body(await pick('http://other:32400')), [
    502,
    { error: 'that address is a different Plex server' },
  ]);
  const [down, why] = await s.body(await pick('http://nowhere:32400'));
  assert.equal(down, 502);
  assert.match(why.error, /^Media Review couldn't reach Plex there/);

  assert.deepEqual(await s.body(await pick('http://plex:32400/')), [200, { ok: true }]);
  assert.deepEqual(s.apps.read().plex, {
    url: 'http://plex:32400',
    token: 'token-1',
    machineId: 'tower-id',
    name: 'Tower',
  });
  assert.equal(s.code(), null, 'the setup code is spent');
  assert.equal(s.changes(), 1);
  const [, me] = await s.body(await s.req('/api/me'));
  assert.equal(me.isOwner, true);
  assert.deepEqual(await s.body(await s.req('/api/setup/code', { method: 'POST', body: { code: CODE } })), [
    409,
    { error: 'already set up' },
  ]);
});

test('signing in during setup with an account that owns no Plex server goes nowhere', async () => {
  const s = await setup();
  await s.req('/api/setup/code', { method: 'POST', body: { code: CODE } });
  assert.equal((await s.plexSignIn(2)).headers.get('location'), '/setup.html?signin=no-server');
  assert.equal(s.apps.isSetUp(), false);
});

// ------------------------------------------------------------------ the Settings page

/** Signed in as the Owner (pin 1) on an install that's set up. */
async function ownerSignedIn() {
  const s = await setup({ setUp: true });
  await s.plexSignIn(1);
  return s;
}

test('only the Owner reaches Settings', async () => {
  const s = await setup({ setUp: true });
  await s.plexSignIn(2);
  assert.equal((await s.req('/api/owner/settings')).status, 403);
  assert.equal(
    (
      await s.req('/api/owner/settings/apps/radarr', {
        method: 'PUT',
        body: { url: 'http://radarr:7878', apiKey: 'k' },
      })
    ).status,
    403,
  );
});

test('an app is saved with its key, the key never comes back, and a blank key keeps the saved one', async () => {
  const s = await ownerSignedIn();
  const put = (/** @type {any} */ b) => s.req('/api/owner/settings/apps/radarr', { method: 'PUT', body: b });
  assert.deepEqual(await s.body(await put({ url: 'http://radarr:7878' })), [400, { error: 'enter its API key' }]);
  assert.deepEqual(await s.body(await put({ url: 'http://radarr:7878/', apiKey: ' secret-key ' })), [
    200,
    { saved: true },
  ]);
  assert.deepEqual(s.apps.read().radarr, { url: 'http://radarr:7878', apiKey: 'secret-key' });

  const page = await s.req('/api/owner/settings');
  const text = await page.text();
  assert.doesNotMatch(text, /secret-key|token-1/, 'no key or Plex token in what the browser gets');
  const radarr = JSON.parse(text).apps.find((/** @type {any} */ a) => a.id === 'radarr');
  assert.deepEqual([radarr.url, radarr.hasKey, radarr.label], ['http://radarr:7878', true, 'Radarr']);

  assert.deepEqual(await s.body(await put({ url: 'http://radarr2:7878', apiKey: '' })), [200, { saved: true }]);
  assert.deepEqual(s.apps.read().radarr, { url: 'http://radarr2:7878', apiKey: 'secret-key' });
  assert.equal(s.changes(), 2);
});

test('only plain http(s) addresses are taken', async () => {
  const s = await ownerSignedIn();
  for (const url of [
    ['java', 'script:alert(1)'].join(''),
    'file:///etc/passwd',
    'http://user:pw@radarr:7878',
    'radarr:7878',
    '',
  ])
    assert.equal(
      (await s.req('/api/owner/settings/apps/radarr', { method: 'PUT', body: { url, apiKey: 'k' } })).status,
      400,
      url,
    );
  assert.equal(
    (await s.req('/api/owner/settings/apps/nope', { method: 'PUT', body: { url: 'http://x', apiKey: 'k' } })).status,
    404,
  );
  assert.equal(
    (await s.req('/api/owner/settings/apps/toString', { method: 'PUT', body: { url: 'http://x', apiKey: 'k' } }))
      .status,
    404,
  );
});

test('Test tries the app with the typed key, or the saved one, and says what is wrong', async () => {
  const s = await ownerSignedIn();
  const test_ = (/** @type {any} */ b) => s.req('/api/owner/settings/apps/radarr/test', { method: 'POST', body: b });
  assert.deepEqual(await s.body(await test_({ url: 'http://radarr:7878', apiKey: 'bad' })), [
    502,
    { error: 'Radarr answered HTTP 401' },
  ]);
  await s.req('/api/owner/settings/apps/radarr', {
    method: 'PUT',
    body: { url: 'http://radarr:7878', apiKey: 'good' },
  });
  assert.deepEqual(await s.body(await test_({ url: 'http://radarr:7878', apiKey: '' })), [
    200,
    { ok: true, version: '5.14.0' },
  ]);
  assert.deepEqual(s.probes.at(-1), { id: 'radarr', url: 'http://radarr:7878', apiKey: 'good' });
  assert.equal(s.apps.read().radarr?.apiKey, 'good', 'testing saves nothing');
});

test('an app can be removed, and the Plex address changed only to the same server', async () => {
  const s = await ownerSignedIn();
  await s.req('/api/owner/settings/apps/sonarrAnime', {
    method: 'PUT',
    body: { url: 'http://sonarr-anime:8989', apiKey: 'k' },
  });
  assert.deepEqual(await s.body(await s.req('/api/owner/settings/apps/sonarrAnime', { method: 'DELETE', body: {} })), [
    200,
    { removed: true },
  ]);
  assert.equal(s.apps.read().sonarrAnime, undefined);

  const plexAt = (/** @type {string} */ url) => s.req('/api/owner/settings/plex', { method: 'PUT', body: { url } });
  assert.deepEqual(await s.body(await plexAt('http://other:32400')), [
    502,
    { error: 'that address is a different Plex server' },
  ]);
  assert.equal(s.apps.read().plex?.url, 'http://plex:32400');
});

test('the public address is set, cleared, and used for sign-in', async () => {
  const s = await ownerSignedIn();
  const set = (/** @type {string} */ publicUrl) =>
    s.req('/api/owner/settings/public-url', { method: 'PUT', body: { publicUrl } });
  assert.equal((await set('not a url')).status, 400);
  assert.deepEqual(await s.body(await set('https://review.example.com/')), [
    200,
    { publicUrl: 'https://review.example.com' },
  ]);
  s.reset();
  const signIn = await s.req('/auth/plex');
  assert.match(String(signIn.headers.getSetCookie()[0]), /; Secure$/);
  await s.plexSignIn(1);
  assert.deepEqual(await s.body(await set('')), [200, { publicUrl: '' }]);
  assert.equal(s.apps.read().publicUrl, undefined);
});

// ------------------------------------------------------------------ the rules

test('only the Owner sees or changes the rules', async () => {
  const s = await setup({ setUp: true });
  await s.plexSignIn(2);
  assert.equal((await s.req('/api/owner/rules')).status, 403);
  assert.equal((await s.req('/api/owner/rules', { method: 'PUT', body: { minimumAudience: '1' } })).status, 403);
});

test('the rules start as the defaults, with the share as a percentage and the show libraries to pick anime from', async () => {
  const s = await ownerSignedIn();
  s.store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'A Movie', library: 'Movies', libraryKey: '1' },
    { ratingKey: 's1', kind: 'show', title: 'A Show', library: 'TV Shows', libraryKey: '2' },
    { ratingKey: 'a1', kind: 'show', title: 'An Anime', library: 'Anime', libraryKey: '3' },
  ]);
  const [, body] = await s.body(await s.req('/api/owner/rules'));
  assert.equal(body.rules.downvoteSharePercent, 50);
  assert.equal(body.rules.minimumAudience, 3);
  assert.equal('downvoteShare' in body.rules, false);
  assert.deepEqual(body.showLibraries, [
    { key: '2', name: 'TV Shows' },
    { key: '3', name: 'Anime' },
  ]);
});

test('values that make no sense are refused with a reason for each, and nothing changes', async () => {
  const s = await ownerSignedIn();
  const [status, body] = await s.body(
    await s.req('/api/owner/rules', {
      method: 'PUT',
      body: { minimumAudience: '0', downvoteSharePercent: '120', titleBonus: '-1' },
    }),
  );
  assert.equal(status, 400);
  assert.deepEqual(Object.keys(body.errors).sort(), ['downvoteShare', 'minimumAudience', 'titleBonus']);
  assert.equal(s.rules.values.minimumAudience, 3);
});

test('lowering the Minimum Audience queues a Title straight away, and raising it again takes nothing out', async () => {
  const s = await ownerSignedIn();
  s.store.replaceTitles([{ ratingKey: 'm1', kind: 'movie', title: 'A Movie' }]);
  for (const v of ['a', 'b']) {
    s.store.upsertVoter({ plexId: v, username: v });
    s.store.upsertPlays([{ id: v, voterId: v, titleKey: 'm1', started: NOW - 60, seconds: 3600, watched: true }]);
    castDownvote(s.store, s.rules.values, v, 'm1', NOW);
  }
  assert.equal(reviewQueue(s.store).length, 0, 'an Audience of 2 is below 3');

  const lower = await s.body(await s.req('/api/owner/rules', { method: 'PUT', body: { minimumAudience: '2' } }));
  assert.deepEqual([lower[0], lower[1].queued, lower[1].rules.minimumAudience], [200, 1, 2]);
  assert.equal(reviewQueue(s.store).length, 1);

  await s.req('/api/owner/rules', { method: 'PUT', body: { minimumAudience: '5' } });
  assert.equal(reviewQueue(s.store).length, 1, 'still queued');
});

test('a library marked as anime uses the anime Sample length', async () => {
  const s = await ownerSignedIn();
  s.store.replaceTitles([{ ratingKey: 'a1', kind: 'show', title: 'An Anime', library: 'Anime', libraryKey: '3' }]);
  for (const v of ['a', 'b', 'c']) {
    s.store.upsertVoter({ plexId: v, username: v });
    // 15 minutes: a Sample at the show length (10), not at an anime length of 20.
    s.store.upsertPlays([{ id: v, voterId: v, titleKey: 'a1', started: NOW - 60, seconds: 15 * 60, watched: false }]);
  }
  await s.req('/api/owner/rules', { method: 'PUT', body: { sampleAnimeMinutes: '20', animeLibraries: ['3'] } });
  castDownvote(s.store, s.rules.values, 'a', 'a1', NOW);
  castDownvote(s.store, s.rules.values, 'b', 'a1', NOW);
  assert.equal(reviewQueue(s.store).length, 0, 'nobody has Sampled it at the anime length');

  const back = await s.body(await s.req('/api/owner/rules', { method: 'PUT', body: { animeLibraries: [] } }));
  assert.equal(back[1].queued, 1, 'as TV, all three Sampled it, and two Downvoted');
});

test("Discord in Settings: Test lists the bot's servers, Save needs one of them, and the token never comes back", async () => {
  const s = await ownerSignedIn();
  const test1 = await s.body(
    await s.req('/api/owner/settings/discord/test', { method: 'POST', body: { token: 'bad' } }),
  );
  assert.deepEqual(test1, [502, { error: 'Discord refused the bot token' }]);
  const ok = await s.body(
    await s.req('/api/owner/settings/discord/test', { method: 'POST', body: { token: 'good-token' } }),
  );
  assert.deepEqual(ok, [
    200,
    {
      bot: 'Media Review',
      guilds: [{ id: 'g1', name: 'Home Lab' }],
      guildId: 'g1',
      channels: [
        { id: 'c1', name: 'announcements' },
        { id: 'c2', name: 'owner-only' },
      ],
      announceChannel: '',
      ownerChannel: '',
    },
  ]);
  // One Test is one look at the bot and its servers; asking again within a minute doesn't ask Discord again.
  const before = discordCalls.filter(c => c.endsWith('/users/@me/guilds')).length;
  await s.req('/api/owner/settings/discord/test', { method: 'POST', body: { token: 'good-token', guildId: 'g1' } });
  assert.equal(discordCalls.filter(c => c.endsWith('/users/@me/guilds')).length, before);
  // With the server picked: its text channels, in Discord's order, not voice ones.
  const inGuild = await s.body(
    await s.req('/api/owner/settings/discord/test', { method: 'POST', body: { token: 'good-token', guildId: 'g1' } }),
  );
  assert.deepEqual(inGuild[1].channels, [
    { id: 'c1', name: 'announcements' },
    { id: 'c2', name: 'owner-only' },
  ]);
  const wrong = await s.req('/api/owner/settings/discord', {
    method: 'PUT',
    body: { token: 'good-token', guildId: 'g9' },
  });
  assert.equal(wrong.status, 400);
  const saved = await s.req('/api/owner/settings/discord', {
    method: 'PUT',
    body: { token: 'good-token', guildId: 'g1' },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(s.apps.read().discord, {
    token: 'good-token',
    guildId: 'g1',
    guildName: 'Home Lab',
    botName: 'Media Review',
    announceChannel: '',
    ownerChannel: '',
    noticesFrom: NOW,
  });
  const notThere = await s.req('/api/owner/settings/discord', {
    method: 'PUT',
    body: { token: '', guildId: 'g1', announceChannel: 'v1' },
  });
  assert.equal(notThere.status, 400, 'a voice channel, or one in another server, is refused');
  await s.req('/api/owner/settings/discord', {
    method: 'PUT',
    body: { token: '', guildId: 'g1', announceChannel: 'c1', ownerChannel: 'c2' },
  });
  assert.deepEqual([s.apps.read().discord?.announceChannel, s.apps.read().discord?.ownerChannel], ['c1', 'c2']);
  const page = await (await s.req('/api/owner/settings')).text();
  assert.doesNotMatch(page, /good-token/);
  assert.match(page, /"guildName":"Home Lab"/);
  // a blank token keeps the saved one
  const again = await s.req('/api/owner/settings/discord/test', { method: 'POST', body: { token: '' } });
  assert.equal(again.status, 200);
  await s.req('/api/owner/settings/discord', { method: 'DELETE', body: {} });
  assert.equal(s.apps.read().discord, undefined);
});
