// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Play history and Voters from Tautulli. Each history row (grouping off) is one session:
// `play_duration` (or `duration` before Tautulli 2.13) is seconds actually played, pauses excluded,
// and `watched_status` 1 means Tautulli counts it as finished: a Watch.
'use strict';
const { fetchJson, join } = require('./http');

/** @typedef {import('./http').Fetch} Fetch */

const PAGE = 1000;

/** @param {{ url: string, apiKey: string, fetch?: Fetch }} cfg */
function tautulli(cfg) {
  const f = cfg.fetch ?? fetch;
  /** @param {string} cmd @param {Record<string, string | number>} [params] */
  const call = async (cmd, params = {}) => {
    const qs = new URLSearchParams({
      apikey: cfg.apiKey,
      cmd,
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    });
    const body = await fetchJson(f, 'Tautulli', join(cfg.url, `/api/v2?${qs}`), { timeoutMs: 60000 });
    if (body?.response?.result !== 'success')
      throw new Error(`Tautulli ${cmd} failed: ${body?.response?.message ?? 'no answer'}`);
    return body.response.data;
  };

  return {
    // Everyone the server is shared with. The Owner (Tautulli's admin) and the "Local" user are not Voters.
    /** @returns {Promise<Array<{ plexId: string, username: string, thumb: string | null }>>} */
    async voters() {
      const users = /** @type {any[]} */ (await call('get_users'));
      return users
        .filter(u => Number(u.user_id) > 0 && !Number(u.is_admin) && (u.is_active == null || Number(u.is_active) === 1))
        .map(u => ({
          plexId: String(u.user_id),
          username: String(u.friendly_name || u.username),
          thumb: u.user_thumb || u.thumb || null,
        }));
    },

    // Every movie and episode session, newest first, from `after` (YYYY-MM-DD) when given.
    /**
     * @param {string} [after]
     * @returns {Promise<Array<{ id: string, voterId: string, titleKey: string, started: number, seconds: number, watched: boolean }>>}
     */
    async history(after) {
      const out = [];
      for (let start = 0; ; start += PAGE) {
        /** @type {Record<string, string | number>} */
        const params = { grouping: 0, start, length: PAGE, order_column: 'date', order_dir: 'desc' };
        if (after) params.after = after;
        const data = await call('get_history', params);
        const rows = /** @type {any[]} */ (data?.data ?? []);
        for (const r of rows) {
          const titleKey =
            r.media_type === 'movie' ? r.rating_key : r.media_type === 'episode' ? r.grandparent_rating_key : null;
          if (!titleKey || r.id == null) continue; // music, live TV, photos
          out.push({
            id: String(r.id),
            voterId: String(r.user_id),
            titleKey: String(titleKey),
            started: Number(r.started),
            seconds: Math.max(0, Number(r.play_duration ?? r.duration ?? 0)),
            watched: Number(r.watched_status) === 1,
          });
        }
        if (rows.length < PAGE) return out;
      }
    },
  };
}

module.exports = { tautulli };
