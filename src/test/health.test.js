// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { jobStatus } = require('../lib/status');
const { health } = require('../lib/health');

const NOW = 1_800_000_000;
const MIN = 60;

function setup() {
  const store = openStore(':memory:');
  store.replaceTitles([{ ratingKey: 'm1', kind: 'movie', title: 'Dull Movie' }]);
  const jobs = jobStatus(store);
  const clock = { t: NOW };
  /** @type {{ connected: boolean, error: string | null, postError?: string | null } | null} */
  let bot = null;
  const check = health({ store, jobs, discord: () => bot, now: () => clock.t, syncSeconds: 15 * MIN });
  return {
    store,
    jobs,
    clock,
    check,
    /** @param {typeof bot} b */
    bot: b => (bot = b),
  };
}

test('all well: nothing to report', () => {
  const s = setup();
  for (const job of ['sync', 'access', 'deletions', 'holdback', 'collections', 'apps', 'discord'])
    s.jobs.record(job, { at: NOW - MIN, ok: true, error: null });
  s.bot({ connected: true, error: null, postError: null });
  assert.deepEqual(s.check(), []);
});

test('a job that failed its last run is a warning, deletion an error; once it runs fine, it is gone', () => {
  const s = setup();
  s.jobs.record('sync', { at: NOW - MIN, ok: false, error: 'tautulli: HTTP 401' });
  s.jobs.record('holdback', { at: NOW - MIN, ok: false, error: 'Seerr answered HTTP 500' });
  s.jobs.record('deletions', { at: NOW - MIN, ok: false, error: 'Radarr is not set up' });
  assert.deepEqual(s.check(), [
    { type: 'warning', source: 'Sync', message: 'Sync failed: tautulli: HTTP 401' },
    { type: 'error', source: 'Overnight deletion', message: 'Overnight deletion failed: Radarr is not set up' },
    {
      type: 'warning',
      source: 'Holding back in Seerr',
      message: 'Holding back in Seerr failed: Seerr answered HTTP 500',
    },
  ]);
  s.jobs.record('holdback', { at: NOW, ok: true, error: null });
  assert.equal(s.check().length, 2);
});

test("a Title that couldn't be deleted overnight is an error until it is", () => {
  const s = setup();
  s.store.remove('m1', NOW - 14 * 86400, NOW - 3600);
  assert.deepEqual(s.check(), []);
  s.store.deleteFailed('m1', 'Sonarr answered HTTP 503', []);
  assert.deepEqual(s.check(), [
    {
      type: 'error',
      source: 'Overnight deletion',
      message:
        "Couldn't delete Dull Movie: Sonarr answered HTTP 503. It stays Leaving Soon and is tried again tonight.",
    },
  ]);
  s.store.deleted('m1', NOW, ['Sonarr']);
  assert.deepEqual(s.check(), []);
});

test('no sync for over an hour is an error; never synced (not set up yet) is not', () => {
  const s = setup();
  assert.deepEqual(s.check(), []);
  s.jobs.record('sync', { at: NOW - 50 * MIN, ok: true, error: null });
  assert.deepEqual(s.check(), [], 'a slow run or two is fine');
  s.clock.t = NOW + 3 * 3600;
  assert.deepEqual(s.check(), [
    {
      type: 'error',
      source: 'Sync',
      message: "Nothing has synced for 3 hours: Downvotes, plays and the Review Queue aren't being updated.",
    },
  ]);
});

test("the Discord bot: a warning once it's been down five minutes, and when posting fails", () => {
  const s = setup();
  s.bot({ connected: false, error: 'Discord refused the bot token' });
  assert.deepEqual(s.check(), [], 'still connecting, perhaps');
  s.clock.t += 5 * MIN;
  assert.deepEqual(s.check(), [
    { type: 'warning', source: 'Discord', message: "The Discord bot isn't connected: Discord refused the bot token." },
  ]);
  s.bot({ connected: true, error: null, postError: 'Missing Access' });
  assert.deepEqual(s.check(), [
    { type: 'warning', source: 'Discord', message: "Couldn't post to Discord: Missing Access" },
  ]);
  // Down again: the five minutes start over.
  s.bot({ connected: false, error: null });
  assert.deepEqual(s.check(), []);
});
