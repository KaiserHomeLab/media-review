// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Deletes each Title whose Leaving Soon is over, overnight, through every Radarr or Sonarr that has it.
// A Title is marked deleted only once it has been; anything that stops that leaves it Leaving Soon,
// with the reason shown to the Owner, and it is tried again the next night.
'use strict';
const { inQuietWindow } = require('./rules');

/**
 * @param {{ store: import('./store').Store, arrs: import('./arr').Arr[], settings: import('./rules').Settings,
 *   now: () => number, log: (msg: string) => void }} ctx
 * @returns {Promise<string[]>} the Titles deleted
 */
async function runDeletions({ store, arrs, settings, now, log }) {
  const t = now();
  if (!inQuietWindow(t, settings.deleteHour)) return [];
  const deleted = [];
  for (const l of store.leavingSoon().filter(x => x.ends_at <= t)) {
    const title = store.title(l.title_key);
    const name = title?.title ?? l.title_key;
    // Apps it's already gone from, if an earlier night half-worked.
    const from = (l.deleted_from ?? '').split(',').filter(Boolean);
    /** @param {string} why */
    const stop = why => {
      store.deleteFailed(l.title_key, why, from);
      log(`Could not delete ${name}: ${why}`);
    };
    if (!title) {
      stop('it is no longer in the catalogue');
      continue;
    }
    const targets = arrs.filter(a => a.handles(title.kind));
    const app = title.kind === 'movie' ? 'Radarr' : 'Sonarr';
    if (!targets.length) {
      stop(`no ${app} is set up in Media Review`);
      continue;
    }
    const ids = { tmdbId: title.tmdb_id, tvdbId: title.tvdb_id };
    if (!(title.kind === 'movie' ? ids.tmdbId : ids.tvdbId)) {
      stop(`Plex has no ${title.kind === 'movie' ? 'TMDB' : 'TVDB'} id for it, so ${app} can't be asked`);
      continue;
    }
    // Every copy in every app that holds this kind: a show may be in the TV or the anime Sonarr.
    /** @type {string[]} */
    const failures = [];
    for (const a of targets) {
      try {
        for (const id of await a.find(ids)) {
          await a.delete(id);
          if (!from.includes(a.name)) from.push(a.name);
        }
      } catch (e) {
        failures.push(`${a.name}: ${e.message}`);
      }
    }
    if (failures.length) stop(failures.join('; '));
    else if (!from.length) stop(`not found in ${targets.map(a => a.name).join(' or ')}, so nothing was deleted`);
    else {
      store.deleted(l.title_key, t, from);
      deleted.push(l.title_key);
      log(`Deleted ${name} from ${from.join(' and ')}, with an import-list exclusion`);
    }
  }
  return deleted;
}

module.exports = { runDeletions };
