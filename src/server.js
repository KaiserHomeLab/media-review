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
const { DEFAULTS } = require('./lib/rules');
const { sync } = require('./lib/sync');
const { createApp } = require('./lib/web');
const { syncLeavingSoon } = require('./lib/collections');
const { appSettings, arrsFrom } = require('./lib/apps');
const { runDeletions } = require('./lib/deletions');

const dataDir = process.env.DATA_DIR ?? path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const store = openStore(path.join(dataDir, 'media-review.db'));
const log = (/** @type {string} */ msg) => console.log(`${new Date().toISOString()} ${msg}`);
const now = () => Math.floor(Date.now() / 1000);

// Plex wants a stable id for this app across restarts.
let clientId = store.getSetting('plexClientId');
if (!clientId) store.setSetting('plexClientId', (clientId = crypto.randomUUID()));

const apps = appSettings(store);

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

const app = createApp({
  store,
  plex,
  machineId,
  settings: DEFAULTS,
  now,
  log,
  publicDir: path.join(__dirname, 'public'),
  leavingChanged: () => void updateCollections(),
  apps,
  setupCode: () => setupCode,
  setupDone: () => {
    setupCode = null;
  },
  // A new or changed app: sync now rather than in up to 15 minutes.
  appsChanged: () => void runSync(),
});
const port = Number(process.env.PORT ?? 8485);
http.createServer(app).listen(port, () => log(`Media Review listening on :${port}`));

const every = Math.max(1, Number(process.env.SYNC_MINUTES ?? 15)) * 60000;
let running = false;
const runSync = async () => {
  if (running) return;
  running = true;
  try {
    if (!apps.isSetUp()) return; // nothing to sync until Plex is linked
    await sync({ store, plex, tautulli: apps.read().tautulli ? tautulli : null, settings: DEFAULTS, now, log });
    // Overnight, Titles whose Leaving Soon is over are deleted; then Plex's collections catch up.
    await runDeletions({ store, arrs: arrsFrom(apps), settings: DEFAULTS, now, log });
    await updateCollections();
  } finally {
    running = false;
  }
};
runSync();
setInterval(runSync, every).unref();

for (const sig of /** @type {const} */ (['SIGTERM', 'SIGINT']))
  process.on(sig, () => {
    store.close();
    process.exit(0);
  });
