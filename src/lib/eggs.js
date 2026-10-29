// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// A small thank-you. Ginger13344 is who made us build this: when they sign in they get a founder badge, an
// "original" Downvote button, and once a year a welcome. Only the page of the person it's for shows any of it.
'use strict';

const FOUNDER = 'ginger13344';

/** @param {string} plexId */
const key = plexId => `founderWelcomed:${plexId}`;
/** @param {number} now */
const yearOf = now => String(new Date(now * 1000).getUTCFullYear());

// The welcome comes the first time, then once a year. It counts as given only once the page has shown it
// (welcomed()), so a reload or a tab opened in the background doesn't use it up unseen.
/**
 * @param {import('./store').Store} store @param {string} plexId @param {string | undefined} username
 * @param {number} now unix seconds
 * @returns {{ founder: true, welcome: boolean } | null}
 */
function eggFor(store, plexId, username, now) {
  if (String(username ?? '').toLowerCase() !== FOUNDER) return null;
  return { founder: true, welcome: store.getSetting(key(plexId)) !== yearOf(now) };
}

/** @param {import('./store').Store} store @param {string} plexId @param {number} now */
const welcomed = (store, plexId, now) => store.setSetting(key(plexId), yearOf(now));

module.exports = { eggFor, welcomed };
