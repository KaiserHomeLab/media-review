// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { DEFAULTS } = require('../lib/rules');
const { ruleSettings, fromForm, toForm } = require('../lib/rule-settings');

test('rules start as the defaults, and the live values follow what is saved', () => {
  const store = openStore(':memory:');
  const rules = ruleSettings(store);
  assert.equal(rules.values.minimumAudience, 3);
  assert.deepEqual({ ...rules.values }, DEFAULTS);
  assert.deepEqual(rules.save({ minimumAudience: 2, downvoteShare: 0.4 }), { ok: true });
  assert.equal(rules.values.minimumAudience, 2, 'live: no restart');
  assert.equal(rules.values.downvoteShare, 0.4);
  assert.equal(rules.values.titleBonus, 2, 'others unchanged');
  // And from the database, as after a restart.
  assert.equal(ruleSettings(store).values.minimumAudience, 2);
});

test('the form shows the share as a percentage, and takes it back as one', () => {
  assert.equal(toForm(DEFAULTS).downvoteSharePercent, 50);
  assert.deepEqual(fromForm({ downvoteSharePercent: '40', minimumAudience: '2' }), {
    downvoteShare: 0.4,
    minimumAudience: 2,
  });
});

test('values that make no sense are refused, each with a reason, and nothing is saved', () => {
  const store = openStore(':memory:');
  const rules = ruleSettings(store);
  const r = rules.save({
    minimumAudience: 0,
    downvoteShare: 1.2,
    sampleMovieMinutes: -5,
    deleteHour: 24,
    titleBonus: NaN,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(/** @type {any} */ (r).errors).sort(), [
    'deleteHour',
    'downvoteShare',
    'minimumAudience',
    'sampleMovieMinutes',
    'titleBonus',
  ]);
  assert.match(/** @type {any} */ (r).errors.minimumAudience, /at least 1/);
  assert.deepEqual({ ...rules.values }, DEFAULTS);
  assert.equal(rules.save({ leavingSoonDays: 1.5 }).ok, false, 'whole days only');
  assert.equal(rules.save({ animeLibraries: ['1', 2] }).ok, false, 'library ids are strings');
  assert.equal(rules.save({ nope: 1 }).ok, false, 'unknown settings are refused');
});
