// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Who still has access. Sign-in checks it once; this checks again after each sync, against plex.tv's list of
// who the server is shared with. Someone it isn't shared with any more is signed out everywhere, their
// Discord commands are refused, and their open Downvotes and Objections stop counting (they're kept, and
// count again if it's shared with them again). Titles already queued keep the Downvotes they were queued with.
'use strict';

/**
 * @param {{ store: import('./store').Store, sharedWith: (machineId: string) => Promise<Set<string>>,
 *   machineId: () => Promise<string>, now: () => number, log: (msg: string) => void }} ctx
 * @returns {Promise<{ removed: string[], restored: string[], error?: string }>} the Voters' names; error when
 *   it couldn't be checked
 */
async function checkAccess({ store, sharedWith, machineId, now, log }) {
  let allowed;
  try {
    allowed = await sharedWith(await machineId());
  } catch (e) {
    const error = `couldn't check who the server is shared with (${e.message}); nobody was signed out`;
    log(`access: ${error}`);
    return { removed: [], restored: [], error };
  }
  const voters = store.voters();
  // An empty answer while Voters exist is far more likely a plex.tv hiccup than everyone being unshared at once.
  if (!allowed.size && voters.some(v => v.removed_at == null)) {
    const error = 'plex.tv listed nobody the server is shared with; nobody was signed out';
    log(`access: ${error}`);
    return { removed: [], restored: [], error };
  }
  const removed = [];
  const restored = [];
  for (const v of voters) {
    const has = allowed.has(v.plex_id);
    if (!has && v.removed_at == null) {
      store.setRemoved(v.plex_id, now());
      store.dropSessionsOf(v.plex_id);
      removed.push(v.username);
      log(`access: ${v.username} no longer has access to the server: signed out, and their votes no longer count`);
    } else if (has && v.removed_at != null) {
      store.setRemoved(v.plex_id, null);
      restored.push(v.username);
      log(`access: ${v.username} has access again: their votes count again`);
    }
  }
  return { removed, restored };
}

module.exports = { checkAccess };
