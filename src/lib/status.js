// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// What the background jobs last did, for the Status card on the Settings page: the sync (Plex, Tautulli),
// the access check, overnight deletion, holding back in Seerr, and Plex's Leaving Soon collections. Kept in
// the database, so it's still there after a restart.
'use strict';

const KEY = 'status';

/** @param {import('./store').Store} store */
function jobStatus(store) {
  /** @returns {Record<string, any>} */
  const read = () => {
    try {
      return JSON.parse(store.getSetting(KEY) ?? '{}') ?? {};
    } catch {
      return {};
    }
  };
  return {
    read,
    /** @param {string} job @param {Record<string, unknown>} result */
    record: (job, result) => store.setSetting(KEY, JSON.stringify({ ...read(), [job]: result })),
  };
}
/** @typedef {ReturnType<typeof jobStatus>} JobStatus */

module.exports = { jobStatus };
