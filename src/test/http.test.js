// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { fetchJson } = require('../lib/http');

test('an app that cannot be reached is described in words, not "fetch failed"', async () => {
  // Nothing listens on this port: find a free one, then close it.
  const s = http.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', () => r(null)));
  const port = /** @type {any} */ (s.address()).port;
  await new Promise(r => s.close(r));
  await assert.rejects(fetchJson(fetch, 'Radarr', `http://127.0.0.1:${port}/api`), {
    message: "nothing is answering at that address and port, so Radarr isn't there",
  });
  await assert.rejects(fetchJson(fetch, 'Radarr', 'http://radarr.invalid:7878/api'), {
    message: 'no such address: is Radarr on the same Docker network, with that name?',
  });
});

test('an app that never answers is reported as a timeout', async () => {
  const s = http.createServer(() => {}); // takes the request, never answers
  await new Promise(r => s.listen(0, '127.0.0.1', () => r(null)));
  test.after(() => s.closeAllConnections() ?? s.close());
  const port = /** @type {any} */ (s.address()).port;
  await assert.rejects(fetchJson(fetch, 'Sonarr', `http://127.0.0.1:${port}/`, { timeoutMs: 200 }), {
    message: "Sonarr didn't answer within 0.2 seconds",
  });
});

test('the diagnostics report hides IP addresses and email addresses', () => {
  const { redact } = require('../lib/diagnostics');
  assert.equal(
    redact('Tautulli at 192.168.1.20:8181 and fe80::1:2:3:4, mail me@example.com'),
    'Tautulli at •.•.•.•:8181 and •:•:•, mail •@•',
  );
});
