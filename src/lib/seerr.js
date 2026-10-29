// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Seerr, for holding back deleted Titles. Seerr can't hold one Title's requests for the Owner (auto-approval
// is per user, not per Title), so a deleted Title goes on Seerr's blocklist and nobody can request it there.
// Friends ask in Media Review instead; when the Owner brings it back, it comes off the blocklist and is
// requested here, approved. Seerr knows movies and shows by their TMDB id. Checked against Seerr 3.5.
'use strict';
const { fetchJson, join } = require('./http');

/** @typedef {import('./http').Fetch} Fetch */
/** @typedef {{ tmdbId: number, mediaType: 'movie' | 'tv' }} SeerrMedia */

/** @param {{ url: string, apiKey: string, fetch?: Fetch }} cfg */
function seerr(cfg) {
  const f = cfg.fetch ?? fetch;
  const headers = { 'X-Api-Key': cfg.apiKey };
  // A change in Seerr. Some answer with no body; `ok` lists the statuses that mean it's already so.
  /** @param {string} method @param {string} path @param {unknown} [body] @param {number[]} [ok] */
  const change = async (method, path, body, ok = []) => {
    let res;
    try {
      res = await f(join(cfg.url, `/api/v1${path}`), {
        method,
        headers: { ...headers, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new Error(`couldn't reach Seerr (${e?.cause?.message ?? e.message})`, { cause: e });
    }
    if (!res.ok && !ok.includes(res.status))
      throw new Error(`Seerr answered HTTP ${res.status} to ${method} ${path.split('?')[0]}`);
    return res.status;
  };
  /** @type {number | null} */
  let me = null;
  // Who the API key acts as (the Seerr admin): a blocklist entry records who added it.
  const meId = async () =>
    (me ??= Number((await fetchJson(f, 'Seerr', join(cfg.url, '/api/v1/auth/me'), { headers })).id));

  return {
    // Nobody can request it in Seerr. Already blocklisted is fine.
    /** @param {SeerrMedia & { title: string }} m */
    block: async m =>
      void (await change(
        'POST',
        '/blocklist',
        { tmdbId: m.tmdbId, mediaType: m.mediaType, title: m.title, user: await meId() },
        [412],
      )),
    // Off the blocklist again. Not on it is fine.
    /** @param {SeerrMedia} m */
    unblock: async m =>
      void (await change('DELETE', `/blocklist/${m.tmdbId}?mediaType=${m.mediaType}`, undefined, [404])),
    // Requested with the API key, so approved straight away; a show with every season.
    /** @param {SeerrMedia} m */
    request: async m =>
      void (await change('POST', '/request', {
        mediaType: m.mediaType,
        mediaId: m.tmdbId,
        ...(m.mediaType === 'tv' ? { seasons: 'all' } : {}),
      })),
  };
}

/** @typedef {ReturnType<typeof seerr>} Seerr */

module.exports = { seerr };
