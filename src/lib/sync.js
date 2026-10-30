// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Pull Voters, Titles and play history in, then re-check every Title with Downvotes.
'use strict';
const { applyWatches, evaluateAll } = require('./review');

const DAY = 86400;

/**
 * @param {{ store: import('./store').Store, plex: ReturnType<typeof import('./plex').plex>,
 *   tautulli: ReturnType<typeof import('./tautulli').tautulli> | null, settings: import('./rules').Settings,
 *   now: () => number, log: (msg: string) => void }} ctx
 * @returns {Promise<{ queued: string[], steps: Array<{ name: string, ok: boolean, error: string | null, count: number | null }> }>}
 *   queued: Titles newly added to the Review Queue; steps: how each part went, for the Status card
 */
async function sync({ store, plex, tautulli, settings, now, log }) {
  // Without Tautulli (not set up yet) there are no Voters or plays to read; Titles still come from Plex.
  // Each step returns how many it read.
  const steps = /** @type {Array<[string, () => Promise<number>]>} */ ([
    [
      'titles',
      async () => {
        const titles = await plex.titles();
        store.replaceTitles(titles);
        return titles.length;
      },
    ],
  ]);
  if (tautulli)
    steps.unshift(
      [
        'voters',
        async () => {
          const voters = await tautulli.voters();
          voters.forEach(store.upsertVoter);
          return voters.length;
        },
      ],
      [
        'play history',
        async () => {
          // Overlap by two days: history rows are upserted by id, so re-reading them is harmless.
          const latest = store.latestPlay();
          const after = latest ? new Date((latest - 2 * DAY) * 1000).toISOString().slice(0, 10) : undefined;
          const plays = await tautulli.history(after);
          store.upsertPlays(plays);
          return plays.length;
        },
      ],
    );
  const done = [];
  for (const [name, step] of steps) {
    try {
      done.push({ name, ok: true, error: null, count: await step() });
    } catch (e) {
      log(`sync: ${name} failed: ${e.message}`);
      done.push({ name, ok: false, error: e.message, count: null });
    }
  }
  if (!tautulli)
    done.push({
      name: 'play history',
      ok: false,
      error: 'Tautulli is not set up, so there are no Voters or plays',
      count: null,
    });
  // A Watch after a Downvote withdraws it, before the threshold is checked again.
  for (const w of applyWatches(store))
    log(`Downvote withdrawn by a Watch: ${store.title(w.titleKey)?.title ?? w.titleKey}`);
  const queued = evaluateAll(store, settings, now());
  for (const key of queued) log(`Review Queue: added ${store.title(key)?.title ?? key}`);
  return { queued, steps: done };
}

module.exports = { sync };
