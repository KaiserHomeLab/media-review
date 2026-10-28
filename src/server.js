// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Media Review: Downvotes, the Review Queue and the rules behind them, for one Plex server.
// Configuration comes from the environment; see the README.
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

/** @param {string} name */
const need = name => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. See the README for every setting.`);
    process.exit(1);
  }
  return v;
};

const dataDir = process.env.DATA_DIR ?? path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const store = openStore(path.join(dataDir, 'media-review.db'));
const log = (/** @type {string} */ msg) => console.log(`${new Date().toISOString()} ${msg}`);
const now = () => Math.floor(Date.now() / 1000);

// Plex wants a stable id for this app across restarts.
let clientId = store.getSetting('plexClientId');
if (!clientId) store.setSetting('plexClientId', (clientId = crypto.randomUUID()));

const plex = plexClient({ url: need('PLEX_URL'), token: need('PLEX_TOKEN'), clientId });
const tautulli = tautulliClient({ url: need('TAUTULLI_URL'), apiKey: need('TAUTULLI_API_KEY') });

/** @type {Promise<string> | null} */
let machine = null;
const machineId = () =>
  (machine ??= plex.machineId().catch(e => {
    machine = null; // try again on the next sign-in
    throw e;
  }));

const app = createApp({
  store,
  plex,
  machineId,
  settings: DEFAULTS,
  now,
  log,
  publicDir: path.join(__dirname, 'public'),
});
const port = Number(process.env.PORT ?? 8484);
http.createServer(app).listen(port, () => log(`Media Review listening on :${port}`));

const every = Math.max(1, Number(process.env.SYNC_MINUTES ?? 15)) * 60000;
let running = false;
const runSync = async () => {
  if (running) return;
  running = true;
  try {
    await sync({ store, plex, tautulli, settings: DEFAULTS, now, log });
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
