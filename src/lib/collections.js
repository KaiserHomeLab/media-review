// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Keeps a pinned "Leaving Soon" collection in each Plex library in step with what is Leaving Soon:
// created and pinned when the first Title arrives, items added and removed, deleted when none is left.
// Safe to run any time: it compares what Plex has with what should be there. Recreates a collection
// someone deleted, and re-pins one someone unpinned.
'use strict';

const TITLE = 'Leaving Soon';

/**
 * @param {{ store: import('./store').Store, plex: ReturnType<typeof import('./plex').plex>,
 *   machineId: () => Promise<string>, log: (msg: string) => void }} ctx
 * @returns {Promise<boolean>} true if every library is in step
 */
async function syncLeavingSoon({ store, plex, machineId, log }) {
  /** @type {Map<string, string[]>} library section → Leaving Soon Titles in it */
  const want = new Map();
  for (const l of store.leavingSoon()) {
    const section = store.title(l.title_key)?.library_key;
    if (section) want.set(section, [...(want.get(section) ?? []), l.title_key]);
  }
  let ok = true;
  for (const { key: section, kind } of store.librarySections()) {
    try {
      const keys = want.get(section) ?? [];
      let id = await plex.findCollection(section, TITLE);
      if (!keys.length) {
        // Nothing left: delete it, so an empty collection doesn't stay pinned on everyone's Home.
        if (id) {
          await plex.deleteCollection(id);
          log(`Plex: removed the empty ${TITLE} collection from library ${section}`);
        }
        continue;
      }
      const machine = await machineId();
      if (!id) {
        id = await plex.createCollection(section, kind, TITLE, machine, keys);
        log(`Plex: made a ${TITLE} collection in library ${section}`);
      } else {
        const have = new Set(await plex.collectionItems(id));
        const add = keys.filter(k => !have.has(k));
        if (add.length) await plex.addToCollection(id, machine, add);
        for (const k of have) if (!keys.includes(k)) await plex.removeFromCollection(id, k);
      }
      await plex.pinCollection(section, id);
    } catch (e) {
      ok = false;
      log(`Plex: could not update ${TITLE} in library ${section}: ${e.message}`);
    }
  }
  return ok;
}

module.exports = { syncLeavingSoon, TITLE };
