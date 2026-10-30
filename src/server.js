// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Media Review: Downvotes, the Review Queue and the rules behind them, for one Plex server.
// The apps it works with are set up in the web app (first setup, then Settings) and kept in /config.
// Only DATA_DIR, PORT, SYNC_MINUTES and TZ come from the environment; see the README.
'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { openStore } = require('./lib/store');
const { plex: plexClient } = require('./lib/plex');
const { tautulli: tautulliClient } = require('./lib/tautulli');
const { ruleSettings } = require('./lib/rule-settings');
const { sync } = require('./lib/sync');
const { createApp } = require('./lib/web');
const { syncLeavingSoon } = require('./lib/collections');
const { APPS, appSettings, arrsFrom, seerrFrom, probe } = require('./lib/apps');
const { rest: discordRest } = require('./lib/discord');
const notices = require('./lib/notices');
const { holdBack } = require('./lib/holdback');
const { checkAccess } = require('./lib/access');
const { jobStatus } = require('./lib/status');
const { inQuietWindow } = require('./lib/rules');
const { runDeletions } = require('./lib/deletions');
const { botRunner } = require('./lib/bot');

const dataDir = process.env.DATA_DIR ?? path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const store = openStore(path.join(dataDir, 'media-review.db'));
const log = (/** @type {string} */ msg) => console.log(`${new Date().toISOString()} ${msg}`);
const now = () => Math.floor(Date.now() / 1000);

// Plex wants a stable id for this app across restarts.
let clientId = store.getSetting('plexClientId');
if (!clientId) store.setSetting('plexClientId', (clientId = crypto.randomUUID()));

const apps = appSettings(store);
// The Owner's rules (Settings → Rules) over the defaults; `settings` is read live, so saving applies at once.
const rules = ruleSettings(store);
const settings = rules.values;

// Clients read their address and key from Settings on every call, so a change applies straight away.
const plex = plexClient({
  clientId,
  get url() {
    return apps.read().plex?.url ?? '';
  },
  get token() {
    return apps.read().plex?.token ?? '';
  },
});
const tautulliCfg = {
  get url() {
    return apps.read().tautulli?.url ?? '';
  },
  get apiKey() {
    return apps.read().tautulli?.apiKey ?? '';
  },
};
const tautulli = tautulliClient(tautulliCfg);
const machineId = async () => {
  const p = apps.read().plex;
  if (!p) throw new Error('Plex is not set up yet');
  return p.machineId;
};

// Until first setup is done, a one-time code in the log is what lets the Owner claim this install.
/** @type {string | null} */
let setupCode = null;
if (!apps.isSetUp()) {
  const raw = crypto
    .randomBytes(6)
    .toString('base64url')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X')
    .slice(0, 8);
  setupCode = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  log('──────────────────────────────────────────────');
  log(`  First setup: open the web app and enter this code: ${setupCode}`);
  log('  (a new code is made each time the container starts, until setup is done)');
  log('──────────────────────────────────────────────');
}

// Bring Plex's Leaving Soon collections in step, one run at a time; a change during a run gets another run.
let collections = Promise.resolve();
let again = false;
let busy = false;
const updateCollections = () => {
  if (busy) {
    again = true;
    return collections;
  }
  busy = true;
  collections = (async () => {
    try {
      do {
        again = false;
        await syncLeavingSoon({ store, plex, machineId, log });
      } while (again);
    } finally {
      busy = false;
    }
  })();
  return collections;
};

// The Discord bot, when it's set up under Settings.
// Which apps answer, checked after each sync: an hour without one is worth telling the Owner.
const healthy = notices.health();
const checkApps = async () => {
  const all = apps.read();
  const t = now();
  /** @type {Array<[string, () => Promise<unknown>]>} */
  const checks = [['Plex', () => plex.machineId()]];
  for (const id of /** @type {import('./lib/apps').AppId[]} */ (Object.keys(APPS))) {
    const cfg = all[id];
    if (cfg) checks.push([APPS[id].label, () => probe(id, cfg)]);
  }
  healthy.only(checks.map(c => c[0]));
  await Promise.all(
    checks.map(async ([name, fn]) => {
      try {
        await fn();
        healthy.ok(name);
      } catch (e) {
        healthy.fail(name, e.message, t);
      }
    }),
  );
};

// Discord announcements and the Owner's messages: what happened is recorded once, then sent; every minute.
/** @type {string | null} */
let postError = null;
let noticing = false;
const runNotices = async () => {
  const d = apps.read().discord;
  const dms = d && d.leavingDms !== false ? { since: d.dmsFrom ?? d.noticesFrom ?? now() } : null;
  if (noticing || !d || !(d.announceChannel || d.ownerChannel || dms)) return;
  noticing = true;
  try {
    notices.collect({
      store,
      now: now(),
      since: d.noticesFrom ?? now(),
      announce: !!d.announceChannel,
      owner: !!d.ownerChannel,
      publicUrl: (apps.read().publicUrl ?? '').replace(/\/+$/, '') || null,
      tz: process.env.TZ || undefined,
      health: healthy,
      dms,
    });
    const r = await notices.deliver({
      store,
      api: discordRest({ token: d.token }),
      channels: { announce: d.announceChannel, owner: d.ownerChannel },
      now: now(),
      log,
    });
    postError = r.error;
  } finally {
    noticing = false;
  }
};
setInterval(() => runNotices().catch(e => log(`Discord notices failed: ${e.message}`)), 60000);

const bot = botRunner({
  store,
  settings,
  now,
  log,
  plex,
  publicUrl: () => (apps.read().publicUrl ?? '').replace(/\/+$/, '') || null,
  leavingChanged: () => void updateCollections(),
  config: () => apps.read().discord,
});
bot.refresh();

const syncMinutes = Math.max(1, Number(process.env.SYNC_MINUTES ?? 15));
const app = createApp({
  store,
  plex,
  machineId,
  settings,
  now,
  log,
  publicDir: path.join(__dirname, 'public'),
  leavingChanged: () => void updateCollections(),
  seerr: () => seerrFrom(apps),
  jobs: jobStatus(store),
  syncNow: () => runSync(),
  syncMinutes,
  discordStatus: () => {
    const s = bot.status();
    return s && { ...s, postError };
  },
  apps,
  rules,
  setupCode: () => setupCode,
  setupDone: () => {
    setupCode = null;
  },
  // A new or changed app: sync now rather than in up to 15 minutes.
  appsChanged: () => {
    bot.refresh();
    void runSync();
  },
});
const port = Number(process.env.PORT ?? 8485);
http.createServer(app).listen(port, () => log(`Media Review listening on :${port}`));

const every = syncMinutes * 60000;
// What each job last did, for Settings → Status.
const status = jobStatus(store);
// Each job runs whatever happened to the one before, and records how it went.
/** @param {string} name @param {() => Promise<Record<string, unknown>>} fn */
const job = async (name, fn) => {
  const at = now();
  try {
    status.record(name, { at, ok: true, error: null, ...(await fn()) });
  } catch (e) {
    log(`${name} failed: ${e.message}`);
    status.record(name, { at, ok: false, error: e.message });
  }
};
// One run at a time; asking while one runs (Sync now) waits for that one.
/** @type {Promise<void> | null} */
let running = null;
const runSync = () => (running ??= syncOnce().finally(() => (running = null)));
const syncOnce = async () => {
  if (!apps.isSetUp()) return; // nothing to sync until Plex is linked
  await job('sync', async () => {
    const r = await sync({ store, plex, tautulli: apps.read().tautulli ? tautulli : null, settings, now, log });
    const failed = r.steps.filter(s => !s.ok);
    return { ok: !failed.length, error: failed.map(s => `${s.name}: ${s.error}`).join('; ') || null, ...r };
  });
  // Anyone the server is no longer shared with is signed out, and their votes stop counting.
  await job('access', async () => {
    const r = await checkAccess({ store, sharedWith: m => plex.sharedWith(m), machineId, now, log });
    return { ok: !r.error, ...r };
  });
  // Overnight, Titles whose Leaving Soon is over are deleted; then Plex's collections catch up. The Status
  // card shows the last night it ran.
  if (inQuietWindow(now(), settings.deleteHour) || !status.read().deletions)
    await job('deletions', async () => {
      const ran = inQuietWindow(now(), settings.deleteHour);
      const deleted = await runDeletions({ store, arrs: arrsFrom(apps), settings, now, log });
      return { ran, deleted: deleted.map(k => store.title(k)?.title ?? k) };
    });
  await job('holdback', async () => ({ blocked: (await holdBack({ store, seerr: seerrFrom(apps), log })).length }));
  await job('collections', async () => (await updateCollections(), {}));
  await job('apps', async () => (await checkApps(), {}));
  await job('discord', async () => (await runNotices(), {}));
};
runSync();
setInterval(runSync, every).unref();

for (const sig of /** @type {const} */ (['SIGTERM', 'SIGINT']))
  process.on(sig, () => {
    store.close();
    process.exit(0);
  });
