// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
process.env.TZ = 'Europe/Amsterdam';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore } = require('../lib/store');
const backup = require('../lib/backup');

const NOW = 1_800_000_000; // 2027-01-15, 09:20 in Amsterdam
const DAY = 86400;
const HOUR = 3600;

test('each night a copy that opens as Media Review; a second one the same day replaces it; the newest 7 kept', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-backup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = openStore(':memory:');
  store.upsertVoter({ plexId: 'a', username: 'alice' });
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a backup: left alone');

  const first = backup.nightly(store, dir, NOW);
  assert.equal(first.file, 'media-review-2027-01-15.db');
  assert.equal(first.kept, 1);
  const copy = openStore(path.join(dir, first.file));
  assert.equal(copy.voter('a')?.username, 'alice');
  copy.close();

  store.upsertVoter({ plexId: 'b', username: 'bob' });
  backup.nightly(store, dir, NOW + HOUR);
  const again = openStore(path.join(dir, first.file));
  assert.equal(again.voter('b')?.username, 'bob', 'the later copy of the day');
  again.close();

  for (let d = 1; d <= 8; d++) backup.nightly(store, dir, NOW + d * DAY);
  const left = fs.readdirSync(dir).sort();
  assert.deepEqual(left, [
    'media-review-2027-01-17.db',
    'media-review-2027-01-18.db',
    'media-review-2027-01-19.db',
    'media-review-2027-01-20.db',
    'media-review-2027-01-21.db',
    'media-review-2027-01-22.db',
    'media-review-2027-01-23.db',
    'notes.txt',
  ]);
});

test('due: none yet, the last failed, overnight after 20 hours, or any time after 36', () => {
  assert.ok(backup.due(undefined, NOW, false));
  assert.ok(backup.due({ at: NOW - HOUR, ok: false }, NOW, false), 'tried again at the next run');
  assert.ok(!backup.due({ at: NOW - 10 * HOUR, ok: true }, NOW, true));
  assert.ok(backup.due({ at: NOW - 21 * HOUR, ok: true }, NOW, true));
  assert.ok(!backup.due({ at: NOW - 21 * HOUR, ok: true }, NOW, false), 'waits for the quiet hours');
  assert.ok(backup.due({ at: NOW - 37 * HOUR, ok: true }, NOW, false));
});
