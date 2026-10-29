// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// The HTTP side: Sign in with Plex, the Voter API behind the web app, the Owner's API key, and
// the API that Media Ops reads with that key.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const {
  castDownvote,
  withdrawDownvote,
  object,
  withdrawObjection,
  keep,
  remove,
  leavingSoon,
  sampledBy,
  reviewQueue,
  evaluateAll,
} = require('./review');
const { APPS, cleanUrl, probe: probeApp } = require('./apps');
const { sampleKind, sampleMinutes } = require('./rules');
const { toForm, fromForm } = require('./rule-settings');
const { fetchJson, join } = require('./http');

const SESSION_DAYS = 30;
const VERSION = require('../package.json').version;
const TYPES = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
});

// A small JSON request body (settings and setup forms). Anything else reads as {}.
/** @param {import('node:http').IncomingMessage} req @returns {Promise<Record<string, unknown>>} */
async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024) throw Object.assign(new Error('request too large'), { status: 413 });
  }
  try {
    const v = JSON.parse(body || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * @typedef {import('node:http').IncomingMessage} Req
 * @typedef {import('node:http').ServerResponse} Res
 * @typedef {{ plexId: string, isOwner: boolean }} Session
 */

/**
 * @param {{ store: import('./store').Store, plex: ReturnType<typeof import('./plex').plex>,
 *   machineId: () => Promise<string>, settings: import('./rules').Settings, now: () => number,
 *   log: (msg: string) => void, publicDir: string, publicUrl?: string,
 *   leavingChanged?: () => void, apps: import('./apps').AppSettings, setupCode?: () => string | null,
 *   setupDone?: () => void, appsChanged?: () => void, probe?: typeof probeApp, fetch?: typeof fetch,
 *   rules?: ReturnType<typeof import('./rule-settings').ruleSettings> }} ctx
 *   rules: where the Owner's rules are saved; `settings` is then rules.values, read live
 *   setupCode: the one-time code printed in the log until first setup is done
 */
function createApp({
  store,
  plex,
  machineId,
  settings,
  now,
  log,
  publicDir,
  publicUrl,
  leavingChanged = () => {},
  apps,
  setupCode = () => null,
  setupDone = () => {},
  appsChanged = () => {},
  probe = probeApp,
  fetch: f = fetch,
  rules,
}) {
  // The public address: from the container (tests) or the Settings page, read fresh each time.
  const base = () => (publicUrl ?? apps.read().publicUrl ?? '').replace(/\/+$/, '') || null;
  /** @param {Res} res @param {number} status @param {unknown} body */
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  /** @param {Res} res @param {string} to @param {string[]} [cookies] */
  const redirect = (res, to, cookies = []) => {
    res.writeHead(303, { Location: to, 'Set-Cookie': cookies });
    res.end();
  };

  /** @param {Req} req @returns {Record<string, string>} */
  const cookiesOf = req =>
    Object.fromEntries(
      (req.headers.cookie ?? '')
        .split(';')
        .map(c => c.trim().split('='))
        .filter(([k, v]) => k && v)
        .map(([k, v]) => [k, decodeURIComponent(v)]),
    );
  /** @param {Req} req */
  const secure = req => {
    const fixed = base();
    return fixed ? fixed.startsWith('https:') : req.headers['x-forwarded-proto'] === 'https';
  };
  /** @param {Req} req @param {string} name @param {string} value @param {number} maxAge seconds */
  const cookie = (req, name, value, maxAge) =>
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;

  /** @param {Req} req @returns {Session | undefined} */
  const sessionOf = req => {
    const token = cookiesOf(req).mr_session;
    return token ? store.session(token, now() - SESSION_DAYS * 86400) : undefined;
  };

  // The Owner's key for Media Ops, sent as X-Api-Key like Sonarr's and Radarr's.
  /** @param {Req} req */
  const apiKeyOk = req => {
    const want = store.getSetting('apiKey');
    const got = req.headers['x-api-key'];
    if (!want || typeof got !== 'string' || got.length !== want.length) return false;
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  };

  /** @param {Req} req */
  // Where Plex sends the Voter back after sign-in: PUBLIC_URL when set (e.g. behind a Cloudflare Tunnel), else
  // what the reverse proxy or browser says.
  const baseUrl = req =>
    base() ?? `${secure(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;

  // ------------------------------------------------------------------ sign in with Plex
  /** @param {Req} req @param {Res} res */
  async function signInStart(req, res) {
    // Before first setup, signing in is only for the Owner linking Plex, with the setup code.
    if (!apps.isSetUp() && !setupOf(req)) return redirect(res, '/setup.html');
    const pin = await plex.createPin();
    redirect(res, plex.authUrl(pin.code, `${baseUrl(req)}/auth/plex/callback`), [
      cookie(req, 'mr_pin', String(pin.id), 900),
    ]);
  }

  /** @param {Req} req @param {Res} res */
  async function signInCallback(req, res) {
    const clearPin = cookie(req, 'mr_pin', '', 0);
    const pinId = Number(cookiesOf(req).mr_pin);
    const token = pinId ? await plex.pinToken(pinId) : null;
    if (!token) return redirect(res, apps.isSetUp() ? '/?signin=failed' : '/setup.html?signin=failed', [clearPin]);
    if (!apps.isSetUp()) return setupSignedIn(req, res, token, clearPin);
    const account = await plex.account(token, await machineId());
    if (account.access === 'none') {
      log(`sign-in refused: ${account.username} has no access to this server`);
      return redirect(res, '/?signin=no-access', [clearPin]);
    }
    const isOwner = account.access === 'owner';
    // The Owner decides; only people the server is shared with are Voters.
    if (!isOwner) store.upsertVoter(account);
    const session = crypto.randomBytes(32).toString('base64url');
    store.addSession(session, account.plexId, isOwner, now());
    redirect(res, '/', [clearPin, cookie(req, 'mr_session', session, SESSION_DAYS * 86400)]);
  }

  // ------------------------------------------------------------------ first setup
  // A fresh install has no Owner. The setup page asks for the one-time code from the log, then the Owner
  // signs in with Plex and picks their server; that links Plex and makes them the Owner.
  /** @type {Map<string, { at: number, token?: string, plexId?: string, servers?: any[] }>} */
  const setups = new Map();
  let wrongCodes = 0;
  /** @param {Req} req */
  const setupOf = req => {
    const s = setups.get(cookiesOf(req).mr_setup ?? '');
    return s && now() - s.at < 3600 && !apps.isSetUp() ? s : undefined;
  };

  /** @param {Req} req @param {Res} res @param {string} token @param {string} clearPin */
  async function setupSignedIn(req, res, token, clearPin) {
    const s = setupOf(req);
    if (!s) return redirect(res, '/setup.html', [clearPin]);
    const [account, servers] = await Promise.all([plex.account(token, ''), plex.ownedServers(token)]);
    if (!servers.length) return redirect(res, '/setup.html?signin=no-server', [clearPin]);
    Object.assign(s, { token, plexId: account.plexId, servers });
    redirect(res, '/setup.html', [clearPin]);
  }

  /** @param {Req} req @param {Res} res @param {string | undefined} m @param {string} p */
  async function setupRoute(req, res, m, p) {
    if (m === 'GET' && p === '/api/setup') {
      const s = setupOf(req);
      return json(res, 200, {
        setUp: apps.isSetUp(),
        step: apps.isSetUp() ? 'done' : !s ? 'code' : !s.token ? 'signin' : 'server',
      });
    }
    if (apps.isSetUp()) return json(res, 409, { error: 'already set up' });
    if (m === 'POST' && p === '/api/setup/code') {
      const code = setupCode();
      // Ten wrong codes and setup is closed until the container restarts with a new code.
      if (!code || wrongCodes >= 10)
        return json(res, 429, { error: 'too many wrong codes: restart the container for a new one' });
      const got = String((await readJson(req)).code ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      const want = code.replace(/[^A-Z0-9]/g, '');
      if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
        wrongCodes++;
        log(`setup: wrong setup code entered (${wrongCodes} of 10)`);
        return json(res, 403, { error: 'wrong code' });
      }
      const id = crypto.randomBytes(32).toString('base64url');
      setups.set(id, { at: now() });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': cookie(req, 'mr_setup', id, 3600) });
      return res.end('{"ok":true}');
    }
    const s = setupOf(req);
    if (!s?.token) return json(res, 403, { error: 'enter the setup code and sign in with Plex first' });
    if (m === 'GET' && p === '/api/setup/servers') return json(res, 200, { servers: s.servers });
    if (m === 'POST' && p === '/api/setup/plex') {
      const body = await readJson(req);
      const server = (s.servers ?? []).find(x => x.machineId === String(body.machineId));
      const url = cleanUrl(body.url);
      if (!server) return json(res, 400, { error: 'pick one of your servers' });
      if (!url) return json(res, 400, { error: 'that is not an http(s) address' });
      const problem = await plexAt(url, s.token, server.machineId);
      if (problem) return json(res, 502, { error: problem });
      apps.setPlex({ url, token: /** @type {string} */ (s.token), machineId: server.machineId, name: server.name });
      setups.clear();
      setupDone();
      appsChanged();
      log(`setup: Plex linked (${server.name} at ${url})`);
      const session = crypto.randomBytes(32).toString('base64url');
      store.addSession(session, /** @type {string} */ (s.plexId), true, now());
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': [cookie(req, 'mr_setup', '', 0), cookie(req, 'mr_session', session, SESSION_DAYS * 86400)],
      });
      return res.end('{"ok":true}');
    }
    return json(res, 404, { error: 'not found' });
  }

  // Is the Plex server at this address the one we mean? null if so, else what's wrong, in words.
  /** @param {string} url @param {string} token @param {string} wantId the server's machine id */
  async function plexAt(url, token, wantId) {
    try {
      const id = await fetchJson(f, 'Plex', join(url, '/identity'), {
        headers: { 'X-Plex-Token': token },
        timeoutMs: 8000,
      });
      const found = id?.MediaContainer?.machineIdentifier;
      return found === wantId ? null : 'that address is a different Plex server';
    } catch (e) {
      return `Media Review couldn't reach Plex there (${e.message})`;
    }
  }

  // ------------------------------------------------------------------ the Owner's Settings page
  // Apps are saved with their API key; the key is never sent back, and leaving it blank keeps it.
  /** @param {Req} req @param {Res} res @param {string | undefined} m @param {string} sub */
  async function settingsRoute(req, res, m, sub) {
    const all = apps.read();
    if (m === 'GET' && sub === '') {
      return json(res, 200, {
        plex: all.plex ? { name: all.plex.name, url: all.plex.url } : null,
        publicUrl: all.publicUrl ?? '',
        apps: Object.entries(APPS).map(([id, a]) => ({
          id,
          ...a,
          url: all[/** @type {import('./apps').AppId} */ (id)]?.url ?? '',
          hasKey: !!all[/** @type {import('./apps').AppId} */ (id)]?.apiKey,
        })),
      });
    }
    if (m === 'PUT' && sub === '/public-url') {
      const raw = String((await readJson(req)).publicUrl ?? '').trim();
      const url = raw ? cleanUrl(raw) : '';
      if (url == null) return json(res, 400, { error: 'that is not an http(s) address' });
      apps.setPublicUrl(url);
      log(`settings: public address ${url ? `set to ${url}` : 'cleared'}`);
      return json(res, 200, { publicUrl: url });
    }
    if (m === 'PUT' && sub === '/plex') {
      const url = cleanUrl((await readJson(req)).url);
      if (!url || !all.plex) return json(res, 400, { error: 'that is not an http(s) address' });
      const problem = await plexAt(url, all.plex.token, all.plex.machineId);
      if (problem) return json(res, 502, { error: problem });
      apps.setPlexUrl(url);
      appsChanged();
      log(`settings: Plex address set to ${url}`);
      return json(res, 200, { url });
    }
    const a = sub.match(/^\/apps\/(\w+)(\/test)?$/);
    const id = /** @type {import('./apps').AppId} */ (a?.[1]);
    if (!a || !Object.hasOwn(APPS, id)) return json(res, 404, { error: 'not found' });
    if (m === 'DELETE' && !a[2]) {
      apps.removeApp(id);
      appsChanged();
      log(`settings: ${APPS[id].label} removed`);
      return json(res, 200, { removed: true });
    }
    if ((m === 'PUT' && !a[2]) || (m === 'POST' && a[2])) {
      const body = await readJson(req);
      const url = cleanUrl(body.url);
      if (!url) return json(res, 400, { error: 'that is not an http(s) address' });
      const apiKey = String(body.apiKey ?? '').trim() || all[id]?.apiKey || '';
      if (!apiKey) return json(res, 400, { error: 'enter its API key' });
      if (a[2]) {
        try {
          return json(res, 200, { ok: true, version: await probe(id, { url, apiKey }, f) });
        } catch (e) {
          return json(res, 502, { error: e.message });
        }
      }
      apps.setApp(id, { url, apiKey });
      appsChanged();
      log(`settings: ${APPS[id].label} saved (${url})`);
      return json(res, 200, { saved: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  // ------------------------------------------------------------------ the rules (Settings → Rules)
  // Saving re-checks every Title that isn't queued, so a lower bar can queue some straight away. Nothing
  // already queued is taken out. A new Leaving Soon length or deletion hour applies from the next Remove.
  /** @param {Req} req @param {Res} res @param {string | undefined} m */
  async function rulesRoute(req, res, m) {
    if (m === 'GET') {
      const shows = store.libraries().filter(l => l.kind === 'show' && l.key);
      return json(res, 200, { rules: toForm(settings), showLibraries: shows.map(l => ({ key: l.key, name: l.name })) });
    }
    if (m !== 'PUT' || !rules) return json(res, 404, { error: 'not found' });
    const r = rules.save(fromForm(await readJson(req)));
    if (!r.ok) return json(res, 400, { error: 'some values are not right', errors: r.errors });
    const queued = evaluateAll(store, settings, now());
    log(`settings: rules saved${queued.length ? `; ${queued.length} Title(s) reached the Review Queue` : ''}`);
    return json(res, 200, { saved: true, queued: queued.length, rules: toForm(settings) });
  }

  // ------------------------------------------------------------------ routes
  /** @param {Req} req @param {Res} res @param {URL} url */
  async function route(req, res, url) {
    const p = url.pathname;
    const m = req.method;

    // Liveness, for Docker's health check. Says nothing about Plex or Tautulli.
    if (m === 'GET' && p === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }
    if (p === '/api/setup' || p.startsWith('/api/setup/')) {
      if (m !== 'GET' && !String(req.headers['content-type']).startsWith('application/json'))
        return json(res, 415, { error: 'send JSON' });
      return setupRoute(req, res, m, p);
    }
    if (m === 'GET' && p === '/auth/plex') return signInStart(req, res);
    if (m === 'GET' && p === '/auth/plex/callback') return signInCallback(req, res);

    // Media Ops API, behind the Owner's API key.
    if (p.startsWith('/api/v1/')) {
      if (!apiKeyOk(req)) return json(res, 401, { error: 'invalid API key' });
      if (m === 'GET' && p === '/api/v1/status') return json(res, 200, { app: 'media-review', version: VERSION });
      const handled = decisions(res, m, p.slice('/api/v1'.length), 'Media Ops');
      if (handled) return handled;
      const poster = p.match(/^\/api\/v1\/poster\/([^/]+)$/);
      if (m === 'GET' && poster) return sendPoster(res, decodeURIComponent(poster[1]));
      return json(res, 404, { error: 'not found' });
    }

    if (p.startsWith('/api/') || p.startsWith('/poster/')) {
      const s = sessionOf(req);
      if (!s) return json(res, 401, { error: 'sign in first' });
      // Cross-site forms can't send a JSON body, so this is the CSRF check for every write.
      if (m !== 'GET' && !String(req.headers['content-type']).startsWith('application/json'))
        return json(res, 415, { error: 'send JSON' });
      return signedIn(req, res, url, s);
    }

    if (m === 'GET') return serveStatic(res, p);
    return json(res, 404, { error: 'not found' });
  }

  /** @param {Req} req @param {Res} res @param {URL} url @param {Session} s */
  async function signedIn(req, res, url, s) {
    const p = url.pathname;
    const m = req.method;

    if (m === 'GET' && p === '/api/me') {
      const v = store.voter(s.plexId);
      return json(res, 200, {
        plexId: s.plexId,
        username: v?.username ?? 'Owner',
        isOwner: s.isOwner,
        sampleMinutes: {
          movie: settings.sampleMovieMinutes,
          show: settings.sampleShowMinutes,
          anime: settings.sampleAnimeMinutes,
        },
      });
    }
    if (m === 'POST' && p === '/api/logout') {
      const token = cookiesOf(req).mr_session;
      if (token) store.dropSession(token);
      res.writeHead(204, { 'Set-Cookie': cookie(req, 'mr_session', '', 0) });
      return res.end();
    }

    if (m === 'GET' && p === '/api/libraries') return json(res, 200, { libraries: store.libraries() });
    // Everyone sees what's Leaving Soon and when; never who Downvoted it.
    if (m === 'GET' && p === '/api/leaving-soon') return json(res, 200, { leavingSoon: leavingSoon(store, now()) });

    if (m === 'GET' && p === '/api/titles') {
      const mine = store.downvotedBy(s.plexId);
      const objected = store.objectedBy(s.plexId);
      const sampled = sampledBy(store, settings, s.plexId);
      const q = (url.searchParams.get('q') ?? '').slice(0, 100);
      const library = url.searchParams.get('library') || undefined;
      const leavingList = leavingSoon(store, now());
      const leaving = new Map(leavingList.map(l => [l.ratingKey, l.daysLeft]));
      const leavingOpen = new Map(leavingList.map(l => [l.ratingKey, l.objectionsOpen]));
      // ?leaving=1: only what's Leaving Soon, soonest first (the library's Leaving Soon tab).
      const rows =
        url.searchParams.get('leaving') === '1'
          ? [...leaving.keys()]
              .map(k => store.title(k))
              .filter(t => !!t && t.title.toLowerCase().includes(q.toLowerCase()))
          : store.searchTitles(q, 60, library);
      const titles = /** @type {import('./store').TitleRow[]} */ (rows).map(t => ({
        ratingKey: t.rating_key,
        kind: t.kind,
        title: t.title,
        year: t.year,
        library: t.library,
        poster: t.thumb ? `/poster/${encodeURIComponent(t.rating_key)}` : null,
        downvoted: mine.has(t.rating_key), // a Voter sees only their own Downvotes
        sampled: sampled(t), // their Downvote only counts once this is true
        sampleMinutes: sampleMinutes(sampleKind(t, settings), settings),
        inReview: store.isQueued(t.rating_key),
        leavingInDays: leaving.get(t.rating_key) ?? null,
        objected: objected.has(t.rating_key), // only ever their own
        objectionsOpen: leavingOpen.get(t.rating_key) ?? false,
      }));
      return json(res, 200, { titles });
    }

    // Objections: "send it back to the Owner", while a Title is Leaving Soon.
    const ob = p.match(/^\/api\/titles\/([^/]+)\/(object|unobject)$/);
    if (m === 'POST' && ob) {
      if (s.isOwner) return json(res, 403, { error: 'The Owner decides directly: Keep after all.' });
      const key = decodeURIComponent(ob[1]);
      if (ob[2] === 'unobject') {
        const r = withdrawObjection(store, s.plexId, key);
        return r.ok ? json(res, 200, { objected: false }) : json(res, 409, { error: r.error });
      }
      const r = object(store, settings, s.plexId, key, now());
      if (!r.ok) return json(res, 409, { error: r.error });
      if (r.sentBack) {
        log(`Sent back by Objections: ${store.title(key)?.title ?? key}`);
        leavingChanged(); // out of Plex's Leaving Soon collection now
      }
      return json(res, 200, { objected: true, sentBack: r.sentBack });
    }

    const wd = p.match(/^\/api\/titles\/([^/]+)\/withdraw$/);
    if (m === 'POST' && wd) {
      const r = withdrawDownvote(store, settings, s.plexId, decodeURIComponent(wd[1]), now());
      return r.ok ? json(res, 200, { downvoted: false }) : json(res, 409, { error: r.error });
    }

    const dv = p.match(/^\/api\/titles\/([^/]+)\/downvote$/);
    if (m === 'POST' && dv) {
      if (s.isOwner) return json(res, 403, { error: 'The Owner decides in Media Ops and does not Downvote.' });
      const key = decodeURIComponent(dv[1]);
      const r = castDownvote(store, settings, s.plexId, key, now());
      if (r.ok) {
        const t = /** @type {import('./store').TitleRow} */ (store.title(key));
        return json(res, 201, { downvoted: true, counts: sampledBy(store, settings, s.plexId)(t) });
      }
      const status = { 'unknown-title': 404, 'already-downvoted': 409, queued: 409, leaving: 409 }[r.error];
      return json(res, status, { error: r.error });
    }

    const poster = p.match(/^\/poster\/([^/]+)$/);
    if (m === 'GET' && poster) return sendPoster(res, decodeURIComponent(poster[1]));

    // Owner only: the Review Queue and its decisions, the same ones Media Ops can make (ADR 0003).
    if (p.startsWith('/api/owner/') && !s.isOwner) return json(res, 403, { error: 'Owner only' });
    if (p.startsWith('/api/owner/')) {
      const handled = decisions(res, m, p.slice('/api/owner'.length), 'Media Review');
      if (handled) return handled;
      if (p === '/api/owner/rules') return rulesRoute(req, res, m);
      if (p === '/api/owner/settings' || p.startsWith('/api/owner/settings/'))
        return settingsRoute(req, res, m, p.slice('/api/owner/settings'.length));
    }

    // Owner only: the API key Media Ops uses.
    if (p === '/api/owner/api-key') {
      if (!s.isOwner) return json(res, 403, { error: 'Owner only' });
      if (m === 'GET') return json(res, 200, { apiKey: store.getSetting('apiKey') ?? null });
      if (m === 'POST') {
        const apiKey = crypto.randomBytes(24).toString('hex');
        store.setSetting('apiKey', apiKey);
        log('API key regenerated by the Owner');
        return json(res, 200, { apiKey });
      }
    }
    return json(res, 404, { error: 'not found' });
  }

  // The Owner's routes, the same under /api/v1 (Media Ops, API key) and /api/owner (the Owner's session), so a
  // decision behaves the same wherever it's made (ADR 0003):
  //   GET  /review-queue                 POST /review-queue/:key/keep    POST /review-queue/:key/remove
  //   GET  /leaving-soon                 POST /leaving-soon/:key/keep    (Keep after all)
  /** @param {Res} res @param {string | undefined} m @param {string} sub the path after the prefix @param {string} via */
  function decisions(res, m, sub, via) {
    if (m === 'GET' && sub === '/review-queue') return json(res, 200, { reviewQueue: reviewQueue(store) });
    if (m === 'GET' && sub === '/leaving-soon')
      return json(res, 200, { leavingSoon: leavingSoon(store, now(), { owner: true, settings }) });
    const d = sub.match(/^\/(review-queue|leaving-soon)\/([^/]+)\/(keep|remove)$/);
    if (m !== 'POST' || !d || (d[1] === 'leaving-soon' && d[3] !== 'keep')) return null;
    const key = decodeURIComponent(d[2]);
    const name = store.title(key)?.title ?? key;
    if (d[3] === 'keep') {
      // Keep after all only applies to a Leaving Soon Title; Keep in the queue only to a queued one.
      const r = (d[1] === 'leaving-soon' ? store.isLeaving(key) : store.isQueued(key))
        ? keep(store, key, now())
        : { ok: false, error: d[1] === 'leaving-soon' ? 'not-leaving' : 'not-queued' };
      if (!r.ok) return json(res, 409, { error: r.error });
      log(`${d[1] === 'leaving-soon' ? 'Keep after all' : 'Keep'} (${via}): ${name}`);
      if (d[1] === 'leaving-soon') leavingChanged();
      return json(res, 200, { kept: true });
    }
    const r = remove(store, settings, key, now());
    if (!r.ok) return json(res, 409, { error: r.error });
    log(`Remove (${via}): ${name}, Leaving Soon until ${new Date(r.endsAt * 1000).toISOString().slice(0, 10)}`);
    leavingChanged();
    return json(res, 200, { removed: true, endsAt: new Date(r.endsAt * 1000).toISOString() });
  }

  // A Title's poster, resized by Plex, so neither the browser nor Media Ops needs a Plex token.
  /** @param {Res} res @param {string} titleKey */
  async function sendPoster(res, titleKey) {
    const t = store.title(titleKey);
    if (!t?.thumb) return json(res, 404, { error: 'no poster' });
    const up = await plex.poster(t.thumb);
    if (!up.ok || !up.body) return json(res, 502, { error: 'Plex had no poster' });
    res.writeHead(200, {
      'Content-Type': up.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    });
    Readable.fromWeb(/** @type {any} */ (up.body)).pipe(res);
  }

  /** @param {Res} res @param {string} p */
  function serveStatic(res, p) {
    const file = path.join(publicDir, p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
      return json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    });
    fs.createReadStream(file).pipe(res);
  }

  /** @param {Req} req @param {Res} res */
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    try {
      await route(req, res, url);
    } catch (e) {
      log(`${req.method} ${url.pathname} failed: ${e.message}`);
      if (!res.headersSent) json(res, 502, { error: e.message });
      else res.destroy();
    }
  };
}

module.exports = { createApp };
