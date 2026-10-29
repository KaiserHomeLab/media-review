// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// A small thank-you. Ginger13344 is who made us build this: when they sign in they get a founder badge, an
// "original" Downvote button, and once a year a welcome. Only the page of the person it's for shows any of it.
'use strict';

const FOUNDER = 'ginger13344';

/**
 * @param {import('./store').Store} store @param {string} plexId @param {string | undefined} username
 * @param {number} now unix seconds
 * @returns {{ founder: true, welcome: boolean } | null}
 */
function eggFor(store, plexId, username, now) {
  if (String(username ?? '').toLowerCase() !== FOUNDER) return null;
  // The welcome comes the first time, then once a year; asking for it again the same year doesn't repeat it.
  const year = String(new Date(now * 1000).getUTCFullYear());
  const key = `founderWelcomed:${plexId}`;
  const welcome = store.getSetting(key) !== year;
  if (welcome) store.setSetting(key, year);
  return { founder: true, welcome };
}

module.exports = { eggFor };
