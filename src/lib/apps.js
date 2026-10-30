// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// The apps Media Review works with, as the Owner set them up on the Settings page: Plex (from first
// setup), Tautulli, Radarr, up to two Sonarrs, and Seerr. Kept in the database (so in /config), read fresh on
// every use, so a change takes effect without a restart. API keys and the Plex token never leave the
// server once saved.
'use strict';
const { fetchJson, join } = require('./http');
const { arr } = require('./arr');
const { seerr } = require('./seerr');

/** @typedef {import('./http').Fetch} Fetch */
/** @typedef {{ url: string, apiKey: string }} AppConfig */
/** @typedef {{ url: string, token: string, machineId: string, name: string }} PlexConfig */
/**
 * @typedef {{ token: string, guildId: string, guildName: string, botName: string, announceChannel?: string,
 *   ownerChannel?: string, noticesFrom?: number, leavingDms?: boolean, dmsFrom?: number }} DiscordConfig
 *   noticesFrom: when channels were first set; nothing that happened before is announced
 *   leavingDms: DM friends what they started is Leaving Soon (off only when false); dmsFrom: when the bot was first
 *   set up, so nothing from before is DMed
 */

// The apps on the Settings page, in order. Plex is set up separately, by signing in.
const APPS = /** @type {const} */ ({
  tautulli: {
    label: 'Tautulli',
    port: 8181,
    keyHelp: 'Tautulli → Settings → Web Interface → API (tick "Enable API").',
    needed: 'Play history: who has tried and watched what.',
  },
  radarr: {
    label: 'Radarr',
    port: 7878,
    keyHelp: 'Radarr → Settings → General → Security → API Key.',
    needed: 'Deletes movies once their Leaving Soon is over.',
  },
  sonarr: {
    label: 'Sonarr',
    port: 8989,
    keyHelp: 'Sonarr → Settings → General → Security → API Key.',
    needed: 'Deletes shows once their Leaving Soon is over.',
  },
  sonarrAnime: {
    label: 'Sonarr (anime)',
    port: 8989,
    keyHelp: "The anime Sonarr's Settings → General → Security → API Key.",
    needed: 'A second Sonarr for anime, if you have one. Shows are deleted from whichever Sonarr has them.',
  },
  seerr: {
    label: 'Seerr',
    port: 5055,
    keyHelp: 'Seerr → Settings → General → API Key.',
    needed:
      "Holds back what's been deleted: it goes on Seerr's blocklist, and friends ask you in Media Review to bring it back.",
  },
});
/** @typedef {keyof typeof APPS} AppId */

const KEY = 'apps';

/** @param {import('./store').Store} store */
function appSettings(store) {
  /** @returns {{ plex?: PlexConfig, publicUrl?: string, discord?: DiscordConfig } & Partial<Record<AppId, AppConfig>>} */
  const read = () => {
    try {
      return JSON.parse(store.getSetting(KEY) ?? '{}');
    } catch {
      return {};
    }
  };
  /** @param {(all: ReturnType<typeof read>) => void} fn */
  const update = fn => {
    const all = read();
    fn(all);
    store.setSetting(KEY, JSON.stringify(all));
  };
  return {
    read,
    /** First setup is done once Plex is linked. */
    isSetUp: () => !!read().plex,
    /** @param {PlexConfig} plex */
    setPlex: plex => update(all => void (all.plex = plex)),
    /** @param {string} url */
    setPlexUrl: url =>
      update(all => {
        if (all.plex) all.plex.url = url;
      }),
    /** @param {AppId} id @param {AppConfig} cfg */
    setApp: (id, cfg) => update(all => void (all[id] = cfg)),
    /** @param {AppId} id */
    removeApp: id => update(all => void delete all[id]),
    /** @param {DiscordConfig | null} cfg null removes it */
    setDiscord: cfg => update(all => void (cfg ? (all.discord = cfg) : delete all.discord)),
    /** @param {string} url '' clears it */
    setPublicUrl: url => update(all => void (url ? (all.publicUrl = url) : delete all.publicUrl)),
  };
}
/** @typedef {ReturnType<typeof appSettings>} AppSettings */

// An app's address: http(s) only, no trailing slash. Returns null for anything else.
/** @param {unknown} v */
function cleanUrl(v) {
  const s = String(v ?? '')
    .trim()
    .replace(/\/+$/, '');
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) && !u.username && !u.password ? s : null;
  } catch {
    return null;
  }
}

// Does it answer, with this key? Resolves with the version it reports, or throws saying what's wrong.
/** @param {AppId} id @param {AppConfig} cfg @param {Fetch} [f] @returns {Promise<string>} */
async function probe(id, cfg, f = fetch) {
  const label = APPS[id].label;
  if (id === 'tautulli') {
    const qs = new URLSearchParams({ apikey: cfg.apiKey, cmd: 'get_tautulli_info' });
    const body = await fetchJson(f, label, join(cfg.url, `/api/v2?${qs}`));
    if (body?.response?.result !== 'success') throw new Error(`${label} refused the API key`);
    return String(body.response.data?.tautulli_version ?? '');
  }
  if (id === 'seerr') {
    const headers = { 'X-Api-Key': cfg.apiKey };
    const me = await fetchJson(f, label, join(cfg.url, '/api/v1/auth/me'), { headers }).catch(e => {
      throw new Error(/HTTP 40[13]/.test(e.message) ? `${label} refused the API key` : e.message, { cause: e });
    });
    if (me?.id == null) throw new Error(`that address isn't ${label}`);
    const status = await fetchJson(f, label, join(cfg.url, '/api/v1/status'), { headers });
    return String(status?.version ?? '');
  }
  const status = await fetchJson(f, label, join(cfg.url, '/api/v3/system/status'), {
    headers: { 'X-Api-Key': cfg.apiKey },
  });
  const appName = String(status?.appName ?? '').toLowerCase();
  const want = id === 'radarr' ? 'radarr' : 'sonarr';
  if (appName && appName !== want)
    throw new Error(`that address is ${status.appName}, not ${want === 'radarr' ? 'Radarr' : 'Sonarr'}`);
  return String(status?.version ?? '');
}

// The Radarr and Sonarrs that are set up, as deletion targets.
/** @param {AppSettings} settings @param {Fetch} [f] */
function arrsFrom(settings, f) {
  const all = settings.read();
  return /** @type {const} */ ([
    ['radarr', 'radarr'],
    ['sonarr', 'sonarr'],
    ['sonarrAnime', 'sonarr'],
  ])
    .filter(([id]) => all[id])
    .map(([id, kind]) => {
      const cfg = /** @type {AppConfig} */ (all[id]);
      return arr({ name: APPS[id].label, kind, url: cfg.url, apiKey: cfg.apiKey, fetch: f });
    });
}

// Seerr, when it's set up.
/** @param {AppSettings} settings @param {Fetch} [f] */
function seerrFrom(settings, f) {
  const cfg = settings.read().seerr;
  return cfg ? seerr({ url: cfg.url, apiKey: cfg.apiKey, fetch: f }) : null;
}

module.exports = { APPS, appSettings, cleanUrl, probe, arrsFrom, seerrFrom };
