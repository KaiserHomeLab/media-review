// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Plex: "Sign in with Plex" through plex.tv's PIN flow, and the Owner's server for the Titles.
'use strict';
const { fetchJson, join } = require('./http');

/** @typedef {import('./http').Fetch} Fetch */

const PLEX_TV = 'https://plex.tv';
const PRODUCT = 'Media Review';

/** @param {{ url: string, token: string, clientId: string, fetch?: Fetch, plexTv?: string }} cfg */
function plex(cfg) {
  const f = cfg.fetch ?? fetch;
  const tv = cfg.plexTv ?? PLEX_TV;
  const tvHeaders = (/** @type {string} */ token = '') => ({
    'X-Plex-Product': PRODUCT,
    'X-Plex-Client-Identifier': cfg.clientId,
    ...(token ? { 'X-Plex-Token': token } : {}),
  });
  /** @param {string} path */
  const server = path => fetchJson(f, 'Plex', join(cfg.url, path), { headers: { 'X-Plex-Token': cfg.token } });

  return {
    // ---------------------------------------------------------------- sign-in (plex.tv)
    /** @returns {Promise<{ id: number, code: string }>} */
    createPin: () => fetchJson(f, 'plex.tv', `${tv}/api/v2/pins?strong=true`, { method: 'POST', headers: tvHeaders() }),

    /** @param {string} code @param {string} forwardUrl */
    authUrl: (code, forwardUrl) =>
      'https://app.plex.tv/auth#?' +
      new URLSearchParams({ clientID: cfg.clientId, code, forwardUrl, 'context[device][product]': PRODUCT }),

    /** @param {number} id @returns {Promise<string | null>} the account's token once the user has approved */
    async pinToken(id) {
      const pin = await fetchJson(f, 'plex.tv', `${tv}/api/v2/pins/${id}`, { headers: tvHeaders() });
      return pin?.authToken || null;
    },

    // Who signed in, and whether they can use the Owner's server at all.
    /**
     * @param {string} token @param {string} machineId
     * @returns {Promise<{ plexId: string, username: string, thumb: string | null, access: 'owner' | 'shared' | 'none' }>}
     */
    async account(token, machineId) {
      const [user, resources] = await Promise.all([
        fetchJson(f, 'plex.tv', `${tv}/api/v2/user`, { headers: tvHeaders(token) }),
        fetchJson(f, 'plex.tv', `${tv}/api/v2/resources?includeHttps=1`, { headers: tvHeaders(token) }),
      ]);
      const res = /** @type {any[]} */ (resources).find(r => r.clientIdentifier === machineId);
      return {
        plexId: String(user.id),
        username: String(user.title || user.username),
        thumb: user.thumb || null,
        access: !res ? 'none' : res.owned ? 'owner' : 'shared',
      };
    },

    // ---------------------------------------------------------------- the Owner's server
    /** @returns {Promise<string>} */
    machineId: async () => (await server('/identity')).MediaContainer.machineIdentifier,

    // Every whole movie and whole show, across all movie and show libraries.
    /** @returns {Promise<Array<{ ratingKey: string, kind: 'movie' | 'show', title: string, year: number | null, thumb: string | null, library: string }>>} */
    async titles() {
      const sections = /** @type {any[]} */ ((await server('/library/sections')).MediaContainer.Directory ?? []);
      const out = [];
      for (const s of sections.filter(x => x.type === 'movie' || x.type === 'show')) {
        const items = /** @type {any[]} */ (
          (await server(`/library/sections/${s.key}/all`)).MediaContainer.Metadata ?? []
        );
        for (const m of items)
          out.push({
            ratingKey: String(m.ratingKey),
            kind: /** @type {'movie' | 'show'} */ (s.type),
            title: String(m.title),
            year: m.year ?? null,
            thumb: m.thumb ?? null,
            library: String(s.title), // as named in Plex: Movies, TV Shows, Anime…
          });
      }
      return out;
    },

    // A poster, resized by Plex, as a fetch Response to stream to the browser.
    /** @param {string} thumb Plex path from titles() */
    poster: thumb =>
      f(
        join(cfg.url, '/photo/:/transcode?') +
          new URLSearchParams({ width: '240', height: '360', minSize: '1', url: thumb, 'X-Plex-Token': cfg.token }),
        { signal: AbortSignal.timeout(15000) },
      ),
  };
}

module.exports = { plex };
