// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { updates, newer, versionOf, VERSION } = require('../lib/selfupdate');

test('versions compare by number, and only a plain release counts', () => {
  assert.ok(newer('1.10.0', '1.9.9'));
  assert.ok(newer('2.0.0', '1.99.99'));
  assert.ok(!newer('1.0.0', '1.0.0'));
  assert.ok(!newer('0.9.0', '1.0.0'));
  assert.equal(versionOf({ tag_name: 'v1.2.3' }), '1.2.3');
  assert.equal(versionOf({ tag_name: 'v1.3.0-beta.1' }), null);
  assert.equal(versionOf({ tag_name: 'v1.3.0', prerelease: true }), null);
  assert.equal(versionOf({ tag_name: 'v1.3.0', draft: true }), null);
});

test('a newer release shows up without anyone waiting on GitHub, at most every 6 hours, and can be turned off', async () => {
  const store = openStore(':memory:');
  let t = 1_000_000_000_000;
  let calls = 0;
  let answer = /** @type {any} */ ({ tag_name: 'v99.0.0', html_url: 'https://github.com/x/releases/tag/v99.0.0' });
  const u = updates({
    store,
    now: () => t,
    fetch: /** @type {any} */ (
      async (/** @type {string} */ url) => {
        calls++;
        assert.equal(url, 'https://api.github.com/repos/KaiserHomeLab/media-review/releases/latest');
        return answer instanceof Error ? new Response('', { status: 503 }) : Response.json(answer);
      }
    ),
  });
  assert.equal(u.latest(), null, 'the first call starts a check and returns at once');
  await u.settle();
  assert.deepEqual(u.latest(), { version: '99.0.0', url: 'https://github.com/x/releases/tag/v99.0.0' });
  assert.equal(calls, 1, 'not asked again within 6 hours');

  answer = { tag_name: `v${VERSION}` };
  t += 7 * 3600e3;
  u.latest();
  await u.settle();
  assert.equal(u.latest(), null, 'this version is the newest');

  answer = new Error('down');
  t += 7 * 3600e3;
  u.latest();
  await u.settle();
  t += 31 * 60e3;
  u.latest();
  await u.settle();
  assert.equal(calls, 4, 'a failed check is tried again after 30 minutes');

  u.setEnabled(false);
  t += 7 * 3600e3;
  assert.equal(u.latest(), null);
  assert.equal(calls, 4, 'turned off: GitHub is never asked');
  assert.equal(u.enabled(), false);
});
