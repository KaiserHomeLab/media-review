// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Backups: everything Media Review keeps is one SQLite database, so a backup is a consistent copy of it
// (VACUUM INTO, safe while it runs). A copy each night goes to <data>/backups, keeping the newest 7; the
// Owner can also download one from Settings. It holds the app keys and tokens too, so keep it private.
// Restoring: stop the container, put a copy back as media-review.db, start it again.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const KEEP = 7;
const HOUR = 3600;
const NAME = /^media-review-\d{4}-\d{2}-\d{2}\.db$/;

/** @param {number} t unix seconds @returns {string} the server's local date, YYYY-MM-DD */
const day = t => {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// A copy of the database at `file`, which must not exist yet.
/** @param {import('./store').Store} store @param {string} file */
const copyTo = (store, file) => void store.db.prepare('VACUUM INTO ?').run(file);

/**
 * Tonight's copy in `dir`, replacing one made earlier today, then only the newest KEEP are kept.
 * @param {import('./store').Store} store @param {string} dir @param {number} now
 * @returns {{ file: string, bytes: number, kept: number }}
 */
function nightly(store, dir, now) {
  fs.mkdirSync(dir, { recursive: true });
  const name = `media-review-${day(now)}.db`;
  const file = path.join(dir, name);
  const tmp = `${file}.partial`;
  fs.rmSync(tmp, { force: true });
  copyTo(store, tmp);
  fs.renameSync(tmp, file);
  const all = fs
    .readdirSync(dir)
    .filter(f => NAME.test(f))
    .sort()
    .reverse();
  for (const old of all.slice(KEEP)) fs.rmSync(path.join(dir, old), { force: true });
  return { file: name, bytes: fs.statSync(file).size, kept: Math.min(all.length, KEEP) };
}

// Whether the nightly copy is due: in the quiet hours if none was made in the last 20 hours, or at any
// time if the last is over a day and a half old, failed, or there's none yet.
/** @param {{ at?: number, ok?: boolean } | undefined} last @param {number} now @param {boolean} quiet */
const due = (last, now, quiet) =>
  !last?.at || !last.ok || now - last.at > 36 * HOUR || (quiet && now - last.at > 20 * HOUR);

module.exports = { nightly, copyTo, due, day, KEEP };
