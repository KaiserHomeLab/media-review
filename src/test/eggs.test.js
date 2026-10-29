// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { eggFor, welcomed } = require('../lib/eggs');

const NOW = Date.UTC(2026, 9, 29) / 1000;
const YEAR = 366 * 86400;

test('the founder gets the badge always, and the welcome until it has been shown, then once a year', () => {
  const store = openStore(':memory:');
  assert.deepEqual(eggFor(store, 'g', 'Ginger13344', NOW), { founder: true, welcome: true });
  assert.deepEqual(eggFor(store, 'g', 'Ginger13344', NOW + 30), { founder: true, welcome: true }, 'not shown yet');
  welcomed(store, 'g', NOW + 40);
  assert.deepEqual(eggFor(store, 'g', 'Ginger13344', NOW + 60), { founder: true, welcome: false });
  assert.deepEqual(eggFor(store, 'g', 'ginger13344', NOW + YEAR), { founder: true, welcome: true }, 'any case');
  assert.equal(eggFor(store, 'a', 'alice', NOW), null, 'nobody else');
  assert.equal(eggFor(store, 'a', undefined, NOW), null);
});
