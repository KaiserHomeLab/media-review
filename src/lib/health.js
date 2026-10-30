// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// What's wrong right now, for Media Ops' Errors & warnings (GET /api/v1/health, in the shape Sonarr and Radarr
// use): a background job that failed its last run, a Title that couldn't be deleted overnight, no sync for over
// an hour, or the Discord bot not connected. Each is there only while it's true. Apps that don't answer are left
// out: Media Ops watches those itself.
'use strict';

const HOUR = 3600;
// A bot that is still connecting after a restart isn't worth a warning; one gone this long is.
const DISCONNECTED_GRACE = 5 * 60;

// The jobs on the Status card, as it names them. 'apps' only checks the other apps, so it isn't here.
const JOBS = /** @type {const} */ ([
  ['sync', 'Sync'],
  ['access', 'Who has access'],
  ['deletions', 'Overnight deletion'],
  ['holdback', 'Holding back in Seerr'],
  ['collections', 'Plex Leaving Soon collection'],
  ['discord', 'Discord'],
  ['backup', 'Nightly backup'],
]);

/** @typedef {{ type: 'error' | 'warning', source: string, message: string }} Problem */

/**
 * @param {{
 *   store: import('./store').Store,
 *   jobs: import('./status').JobStatus,
 *   discord: () => { connected: boolean, error: string | null, postError?: string | null } | null,
 *   now: () => number,
 *   syncSeconds: number,
 * }} ctx
 */
function health({ store, jobs, discord, now, syncSeconds }) {
  /** @type {number | null} */
  let disconnectedSince = null;
  /** @returns {Problem[]} */
  return () => {
    const t = now();
    const all = jobs.read();
    /** @type {Problem[]} */
    const out = [];
    // Stalled: a run takes minutes, so two missed runs (and at least an hour) means something is stuck.
    const last = all.sync?.at;
    if (last && t - last > Math.max(HOUR, 2 * syncSeconds))
      out.push({
        type: 'error',
        source: 'Sync',
        message: `Nothing has synced for ${Math.floor((t - last) / HOUR)} hours: Downvotes, plays and the Review Queue aren't being updated.`,
      });
    for (const [key, label] of JOBS) {
      const j = all[key];
      if (j && !j.ok && j.error)
        out.push({
          type: key === 'deletions' ? 'error' : 'warning',
          source: label,
          message: `${label} failed: ${j.error}`,
        });
    }
    for (const l of store.leavingSoon())
      if (l.delete_error)
        out.push({
          type: 'error',
          source: 'Overnight deletion',
          message: `Couldn't delete ${store.title(l.title_key)?.title ?? l.title_key}: ${l.delete_error}. It stays Leaving Soon and is tried again tonight.`,
        });
    const d = discord();
    if (d && !d.connected) {
      disconnectedSince ??= t;
      if (t - disconnectedSince >= DISCONNECTED_GRACE)
        out.push({
          type: 'warning',
          source: 'Discord',
          message: `The Discord bot isn't connected${d.error ? `: ${d.error}` : ''}.`,
        });
    } else disconnectedSince = null;
    if (d?.postError)
      out.push({ type: 'warning', source: 'Discord', message: `Couldn't post to Discord: ${d.postError}` });
    return out;
  };
}

module.exports = { health };
