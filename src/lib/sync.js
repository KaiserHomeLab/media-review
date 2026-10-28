// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Pull Voters, Titles and play history in, then re-check every Title with Downvotes.
'use strict';
const { applyWatches, evaluateAll } = require('./review');

const DAY = 86400;

/**
 * @param {{ store: import('./store').Store, plex: ReturnType<typeof import('./plex').plex>,
 *   tautulli: ReturnType<typeof import('./tautulli').tautulli>, settings: import('./rules').Settings,
 *   now: () => number, log: (msg: string) => void }} ctx
 * @returns {Promise<string[]>} Titles newly added to the Review Queue
 */
async function sync({ store, plex, tautulli, settings, now, log }) {
  const steps = /** @type {Array<[string, () => Promise<void>]>} */ ([
    ['voters', async () => (await tautulli.voters()).forEach(store.upsertVoter)],
    ['titles', async () => store.replaceTitles(await plex.titles())],
    [
      'play history',
      async () => {
        // Overlap by two days: history rows are upserted by id, so re-reading them is harmless.
        const latest = store.latestPlay();
        const after = latest ? new Date((latest - 2 * DAY) * 1000).toISOString().slice(0, 10) : undefined;
        store.upsertPlays(await tautulli.history(after));
      },
    ],
  ]);
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (e) {
      log(`sync: ${name} failed: ${e.message}`);
    }
  }
  // A Watch after a Downvote withdraws it, before the threshold is checked again.
  for (const w of applyWatches(store))
    log(`Downvote withdrawn by a Watch: ${store.title(w.titleKey)?.title ?? w.titleKey}`);
  const queued = evaluateAll(store, settings, now());
  for (const key of queued) log(`Review Queue: added ${store.title(key)?.title ?? key}`);
  return queued;
}

module.exports = { sync };
