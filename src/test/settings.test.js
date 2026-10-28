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
const { appSettings } = require('../lib/apps');

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

// What answers at each address: Plex's /identity, by host.
/** @type {typeof fetch} */
const fakeFetch = async url => {
  const u = new URL(String(url));
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
  const app = createApp({
    store,
    apps,
    plex: fakePlex,
    machineId: async () => apps.read().plex?.machineId ?? '',
    settings: DEFAULTS,
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
