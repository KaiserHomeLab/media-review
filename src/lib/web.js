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
const { castDownvote, withdrawDownvote, keep, sampledBy, reviewQueue } = require('./review');

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

/**
 * @typedef {import('node:http').IncomingMessage} Req
 * @typedef {import('node:http').ServerResponse} Res
 * @typedef {{ plexId: string, isOwner: boolean }} Session
 */

/**
 * @param {{ store: import('./store').Store, plex: ReturnType<typeof import('./plex').plex>,
 *   machineId: () => Promise<string>, settings: import('./rules').Settings, now: () => number,
 *   log: (msg: string) => void, publicDir: string, publicUrl?: string }} ctx
 */
function createApp({ store, plex, machineId, settings, now, log, publicDir, publicUrl }) {
  const fixedBase = publicUrl ? publicUrl.replace(/\/+$/, '') : null;
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
  const secure = req => (fixedBase ? fixedBase.startsWith('https:') : req.headers['x-forwarded-proto'] === 'https');
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
    fixedBase ?? `${secure(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;

  // ------------------------------------------------------------------ sign in with Plex
  /** @param {Req} req @param {Res} res */
  async function signInStart(req, res) {
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
    if (!token) return redirect(res, '/?signin=failed', [clearPin]);
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
    if (m === 'GET' && p === '/auth/plex') return signInStart(req, res);
    if (m === 'GET' && p === '/auth/plex/callback') return signInCallback(req, res);

    // Media Ops API, behind the Owner's API key.
    if (p.startsWith('/api/v1/')) {
      if (!apiKeyOk(req)) return json(res, 401, { error: 'invalid API key' });
      if (m === 'GET' && p === '/api/v1/status') return json(res, 200, { app: 'media-review', version: VERSION });
      if (m === 'GET' && p === '/api/v1/review-queue') return json(res, 200, { reviewQueue: reviewQueue(store) });
      const decide = p.match(/^\/api\/v1\/review-queue\/([^/]+)\/keep$/);
      if (m === 'POST' && decide) return decideKeep(res, decodeURIComponent(decide[1]), 'Media Ops');
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
        sampleMinutes: { movie: settings.sampleMovieMinutes, show: settings.sampleShowMinutes },
      });
    }
    if (m === 'POST' && p === '/api/logout') {
      const token = cookiesOf(req).mr_session;
      if (token) store.dropSession(token);
      res.writeHead(204, { 'Set-Cookie': cookie(req, 'mr_session', '', 0) });
      return res.end();
    }

    if (m === 'GET' && p === '/api/libraries') return json(res, 200, { libraries: store.libraries() });

    if (m === 'GET' && p === '/api/titles') {
      const mine = store.downvotedBy(s.plexId);
      const sampled = sampledBy(store, settings, s.plexId);
      const q = (url.searchParams.get('q') ?? '').slice(0, 100);
      const library = url.searchParams.get('library') || undefined;
      const titles = store.searchTitles(q, 60, library).map(t => ({
        ratingKey: t.rating_key,
        kind: t.kind,
        title: t.title,
        year: t.year,
        library: t.library,
        poster: t.thumb ? `/poster/${encodeURIComponent(t.rating_key)}` : null,
        downvoted: mine.has(t.rating_key), // a Voter sees only their own Downvotes
        sampled: sampled(t), // their Downvote only counts once this is true
        inReview: store.isQueued(t.rating_key),
      }));
      return json(res, 200, { titles });
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
      const status = { 'unknown-title': 404, 'already-downvoted': 409, queued: 409 }[r.error];
      return json(res, status, { error: r.error });
    }

    const poster = p.match(/^\/poster\/([^/]+)$/);
    if (m === 'GET' && poster) return sendPoster(res, decodeURIComponent(poster[1]));

    // Owner only: the Review Queue and its decisions, the same ones Media Ops can make (ADR 0003).
    if (p.startsWith('/api/owner/') && !s.isOwner) return json(res, 403, { error: 'Owner only' });
    if (m === 'GET' && p === '/api/owner/review-queue') return json(res, 200, { reviewQueue: reviewQueue(store) });
    const ownerKeep = p.match(/^\/api\/owner\/review-queue\/([^/]+)\/keep$/);
    if (m === 'POST' && ownerKeep) return decideKeep(res, decodeURIComponent(ownerKeep[1]), 'Media Review');

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

  // The Owner's Keep, from Media Ops or from Media Review's own Review Queue page.
  /** @param {Res} res @param {string} key @param {string} via */
  function decideKeep(res, key, via) {
    const r = keep(store, key, now());
    if (!r.ok) return json(res, 409, { error: r.error });
    log(`Keep (${via}): ${store.title(key)?.title ?? key}`);
    return json(res, 200, { kept: true });
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
