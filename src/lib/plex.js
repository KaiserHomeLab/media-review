// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Plex: "Sign in with Plex" through plex.tv's PIN flow, and the Owner's server for the Titles.
'use strict';
const { fetchJson, join } = require('./http');

/** @typedef {import('./http').Fetch} Fetch */

const PLEX_TV = 'https://plex.tv';

// The ids Radarr and Sonarr know a Title by, from Plex's Guid list (tmdb://603, tvdb://81189, …).
/** @param {unknown} guids @returns {{ tmdbId: string | null, tvdbId: string | null }} */
function externalIds(guids) {
  const ids = /** @type {any[]} */ (Array.isArray(guids) ? guids : []).map(g => String(g?.id ?? ''));
  /** @param {string} scheme */
  const find = scheme => ids.find(id => id.startsWith(`${scheme}://`))?.slice(scheme.length + 3) || null;
  return { tmdbId: find('tmdb'), tvdbId: find('tvdb') };
}
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
  // A change on the server (POST, PUT, DELETE). Plex often answers these with an empty body.
  /** @param {string} method @param {string} path */
  const change = async (method, path) => {
    const res = await f(join(cfg.url, path), {
      method,
      headers: { Accept: 'application/json', 'X-Plex-Token': cfg.token },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Plex answered HTTP ${res.status} to ${method} ${path.split('?')[0]}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
  /** @param {string} machineId @param {string[]} keys */
  const itemsUri = (machineId, keys) =>
    `server://${machineId}/com.plexapp.plugins.library/library/metadata/${keys.join(',')}`;

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

    // First setup: the servers this account owns, with every address Plex knows for each.
    /**
     * @param {string} token
     * @returns {Promise<Array<{ machineId: string, name: string, addresses: Array<{ url: string, local: boolean }> }>>}
     */
    async ownedServers(token) {
      const resources = /** @type {any[]} */ (
        await fetchJson(f, 'plex.tv', `${tv}/api/v2/resources?includeHttps=1&includeRelay=0`, {
          headers: tvHeaders(token),
        })
      );
      return resources
        .filter(
          r =>
            r.owned &&
            String(r.provides ?? '')
              .split(',')
              .includes('server'),
        )
        .map(r => ({
          machineId: String(r.clientIdentifier),
          name: String(r.name),
          addresses: /** @type {any[]} */ (r.connections ?? [])
            .filter(c => !c.relay && c.uri)
            .map(c => ({ url: String(c.uri), local: !!c.local })),
        }));
    },

    // ---------------------------------------------------------------- the Owner's server
    /** @returns {Promise<string>} */
    machineId: async () => (await server('/identity')).MediaContainer.machineIdentifier,

    // Every whole movie and whole show, across all movie and show libraries.
    /** @returns {Promise<Array<{ ratingKey: string, kind: 'movie' | 'show', title: string, year: number | null, thumb: string | null, library: string, libraryKey: string,
     *   tmdbId: string | null, tvdbId: string | null }>>} */
    async titles() {
      const sections = /** @type {any[]} */ ((await server('/library/sections')).MediaContainer.Directory ?? []);
      const out = [];
      for (const s of sections.filter(x => x.type === 'movie' || x.type === 'show')) {
        const items = /** @type {any[]} */ (
          (await server(`/library/sections/${s.key}/all?includeGuids=1`)).MediaContainer.Metadata ?? []
        );
        for (const m of items)
          out.push({
            ratingKey: String(m.ratingKey),
            kind: /** @type {'movie' | 'show'} */ (s.type),
            title: String(m.title),
            year: m.year ?? null,
            thumb: m.thumb ?? null,
            library: String(s.title), // as named in Plex: Movies, TV Shows, Anime…
            libraryKey: String(s.key),
            ...externalIds(m.Guid),
          });
      }
      return out;
    },

    // ---------------------------------------------------------------- collections (Leaving Soon)
    // The same calls Plex Web makes. A pinned collection is a "managed hub" of its library, identified as
    // custom.collection.<section>.<collection>.

    /** @param {string} section @param {string} title @returns {Promise<string | null>} the collection's ratingKey */
    async findCollection(section, title) {
      const c = /** @type {any[]} */ (
        (await server(`/library/sections/${section}/collections`)).MediaContainer.Metadata ?? []
      );
      return c.find(x => x.title === title)?.ratingKey?.toString() ?? null;
    },

    /** @param {string} id @returns {Promise<string[]>} */
    async collectionItems(id) {
      const items = /** @type {any[]} */ (
        (await server(`/library/collections/${id}/children`)).MediaContainer.Metadata ?? []
      );
      return items.map(m => String(m.ratingKey));
    },

    /**
     * @param {string} section @param {'movie' | 'show'} kind @param {string} title @param {string} machineId
     * @param {string[]} keys at least one: Plex makes a collection from its first items
     * @returns {Promise<string>} the new collection's ratingKey
     */
    async createCollection(section, kind, title, machineId, keys) {
      const qs = new URLSearchParams({
        type: kind === 'movie' ? '1' : '2',
        title,
        smart: '0',
        sectionId: section,
        uri: itemsUri(machineId, keys),
      });
      const made = await change('POST', `/library/collections?${qs}`);
      const id = made?.MediaContainer?.Metadata?.[0]?.ratingKey;
      if (id == null) throw new Error('Plex made the collection but did not say its id');
      return String(id);
    },

    /** @param {string} id @param {string} machineId @param {string[]} keys */
    addToCollection: (id, machineId, keys) =>
      change('PUT', `/library/collections/${id}/items?${new URLSearchParams({ uri: itemsUri(machineId, keys) })}`),

    /** @param {string} id @param {string} key */
    removeFromCollection: (id, key) => change('DELETE', `/library/collections/${id}/items/${key}`),

    /** @param {string} id */
    deleteCollection: id => change('DELETE', `/library/metadata/${id}`),

    // Pinned to the library's Recommended tab, the Owner's Home and friends' Home (the Owner's choice).
    /** @param {string} section @param {string} id */
    async pinCollection(section, id) {
      const pins = 'promotedToRecommended=1&promotedToOwnHome=1&promotedToSharedHome=1';
      const identifier = `custom.collection.${section}.${id}`;
      const hubs = /** @type {any[]} */ ((await server(`/hubs/sections/${section}/manage`)).MediaContainer.Hub ?? []);
      const hub = hubs.find(h => h.identifier === identifier);
      if (!hub) return change('POST', `/hubs/sections/${section}/manage?metadataItemId=${id}&${pins}`);
      if (!(hub.promotedToRecommended && hub.promotedToOwnHome && hub.promotedToSharedHome))
        return change('PUT', `/hubs/sections/${section}/manage/${encodeURIComponent(identifier)}?${pins}`);
      return null;
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
