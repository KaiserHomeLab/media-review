// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Is a newer Media Review out? Reads the latest release from GitHub's API at most every 6 hours, as Media Ops
// does. Only a plain GET: nothing about this server is sent. The Owner can turn it off under Settings → Status.
'use strict';
const VERSION = require('../package.json').version;

const LATEST = 'https://api.github.com/repos/KaiserHomeLab/media-review/releases/latest';
const EVERY = 6 * 3600e3;
const KEY = 'checkUpdates';

/** @param {string} a @param {string} b is a newer than b? */
const newer = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

// "v1.2.3" -> "1.2.3"; a pre-release, a draft or anything else -> null.
/** @param {any} release GitHub's latest-release reply */
const versionOf = release => {
  const m = /^v?(\d+\.\d+\.\d+)$/.exec(String(release?.tag_name ?? ''));
  return m && !release.prerelease && !release.draft ? m[1] : null;
};

/** @param {{ store: import('./store').Store, fetch?: typeof fetch, now?: () => number }} ctx now: ms */
function updates({ store, fetch: f = fetch, now = Date.now }) {
  let last = { at: 0, latest: /** @type {string | null} */ (null), url: /** @type {string | null} */ (null) };
  /** @type {Promise<void> | null} */
  let pending = null;
  const enabled = () => store.getSetting(KEY) !== '0';
  return {
    enabled,
    /** @param {boolean} on */
    setEnabled: on => store.setSetting(KEY, on ? '1' : '0'),
    // The newer release, or null. Never waits on the network: a check starts in the background, and later
    // calls see its answer. A failed check is tried again in 30 minutes.
    /** @returns {{ version: string, url: string | null } | null} */
    latest() {
      if (!enabled()) return null;
      if (now() - last.at > EVERY && !pending)
        pending = f(LATEST, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) })
          .then(async res => {
            if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
            const r = await res.json();
            last = { at: now(), latest: versionOf(r), url: typeof r.html_url === 'string' ? r.html_url : null };
          })
          .catch(() => {
            last = { ...last, at: now() - EVERY + 30 * 60e3 };
          })
          .finally(() => (pending = null));
      return last.latest && newer(last.latest, VERSION) ? { version: last.latest, url: last.url } : null;
    },
    // For tests: wait for a check that's under way.
    settle: () => pending ?? Promise.resolve(),
  };
}
/** @typedef {ReturnType<typeof updates>} Updates */

module.exports = { updates, newer, versionOf, VERSION };
