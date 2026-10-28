// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Radarr and Sonarr, for deleting a Title once its Leaving Soon is over. A movie is found in Radarr by
// its TMDB id and a show in Sonarr by its TVDB id, the ids Plex has for it. Deleting removes the files
// and adds an import-list exclusion, so lists don't download it again (the Owner's choice).
'use strict';
const { fetchJson, join } = require('./http');

/** @typedef {import('./http').Fetch} Fetch */

/**
 * @param {{ name: string, kind: 'radarr' | 'sonarr', url: string, apiKey: string, fetch?: Fetch }} cfg
 *   name is how the Owner knows it: Radarr, Sonarr, Sonarr (anime)
 */
function arr(cfg) {
  const f = cfg.fetch ?? fetch;
  const radarr = cfg.kind === 'radarr';
  const headers = { 'X-Api-Key': cfg.apiKey };
  const resource = radarr ? 'movie' : 'series';
  return {
    name: cfg.name,
    // Radarr holds movies, Sonarr shows.
    handles: (/** @type {'movie' | 'show'} */ kind) => (radarr ? kind === 'movie' : kind === 'show'),

    // Every copy with this id: normally one, but nothing stops an app from holding two.
    /** @param {{ tmdbId: string | null, tvdbId: string | null }} ids @returns {Promise<number[]>} */
    async find(ids) {
      const id = radarr ? ids.tmdbId : ids.tvdbId;
      if (!id) return [];
      const all = /** @type {any[]} */ (
        await fetchJson(f, cfg.name, join(cfg.url, `/api/v3/${resource}`), { headers, timeoutMs: 60000 })
      );
      return all.filter(x => String(radarr ? x.tmdbId : x.tvdbId) === id).map(x => Number(x.id));
    },

    /** @param {number} id */
    async delete(id) {
      const exclusion = radarr ? 'addImportExclusion' : 'addImportListExclusion';
      const res = await f(join(cfg.url, `/api/v3/${resource}/${id}?deleteFiles=true&${exclusion}=true`), {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok && res.status !== 404) throw new Error(`${cfg.name} answered HTTP ${res.status}`);
    },
  };
}

/** @typedef {ReturnType<typeof arr>} Arr */

module.exports = { arr };
