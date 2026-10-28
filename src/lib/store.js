// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Everything Media Review keeps, in one SQLite file (node:sqlite, so no npm dependencies).
'use strict';
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS voters (
  plex_id TEXT PRIMARY KEY, username TEXT NOT NULL, thumb TEXT
);
CREATE TABLE IF NOT EXISTS titles (
  rating_key TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('movie', 'show')),
  title TEXT NOT NULL, year INTEGER, thumb TEXT, seen INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS plays (
  id TEXT PRIMARY KEY, voter_id TEXT NOT NULL, title_key TEXT NOT NULL,
  started INTEGER NOT NULL, seconds INTEGER NOT NULL, watched INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plays_title ON plays (title_key);
CREATE INDEX IF NOT EXISTS plays_started ON plays (started);
CREATE TABLE IF NOT EXISTS downvotes (
  voter_id TEXT NOT NULL, title_key TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (voter_id, title_key)
);
CREATE TABLE IF NOT EXISTS review_queue (
  title_key TEXT PRIMARY KEY, queued_at INTEGER NOT NULL,
  audience INTEGER NOT NULL, audience_weight REAL NOT NULL, downvote_weight REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS queued_downvotes (
  title_key TEXT NOT NULL, voter_id TEXT NOT NULL, vote_weight REAL NOT NULL, in_audience INTEGER NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY (title_key, voter_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, plex_id TEXT NOT NULL, is_owner INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/**
 * @typedef {{ plex_id: string, username: string, thumb: string | null }} VoterRow
 * @typedef {{ rating_key: string, kind: 'movie' | 'show', title: string, year: number | null,
 *   thumb: string | null }} TitleRow
 * @typedef {{ id: string, voter_id: string, title_key: string, started: number, seconds: number,
 *   watched: number }} PlayRow
 */

/** @param {string} file ':memory:' in tests */
function openStore(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  /** @param {() => void} fn */
  const tx = fn => {
    db.exec('BEGIN');
    try {
      fn();
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  const q = {
    upsertVoter: db.prepare(
      `INSERT INTO voters (plex_id, username, thumb) VALUES (?, ?, ?)
       ON CONFLICT (plex_id) DO UPDATE SET username = excluded.username, thumb = excluded.thumb`,
    ),
    upsertTitle: db.prepare(
      `INSERT INTO titles (rating_key, kind, title, year, thumb, seen) VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT (rating_key) DO UPDATE SET kind = excluded.kind, title = excluded.title,
         year = excluded.year, thumb = excluded.thumb, seen = 1`,
    ),
    upsertPlay: db.prepare(
      `INSERT INTO plays (id, voter_id, title_key, started, seconds, watched) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET seconds = excluded.seconds, watched = excluded.watched`,
    ),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    ),
  };

  return {
    db,
    tx,

    /** @param {{ plexId: string, username: string, thumb?: string | null }} v */
    upsertVoter: v => void q.upsertVoter.run(v.plexId, v.username, v.thumb ?? null),
    /** @param {string} plexId @returns {VoterRow | undefined} */
    voter: plexId => /** @type {any} */ (db.prepare('SELECT * FROM voters WHERE plex_id = ?').get(plexId)),

    // Replace the catalogue: titles no longer in Plex stay (their history matters) but are hidden.
    /** @param {Array<{ ratingKey: string, kind: 'movie' | 'show', title: string, year?: number | null, thumb?: string | null }>} list */
    replaceTitles: list =>
      tx(() => {
        db.exec('UPDATE titles SET seen = 0');
        for (const t of list) q.upsertTitle.run(t.ratingKey, t.kind, t.title, t.year ?? null, t.thumb ?? null);
      }),
    /** @param {string} key @returns {TitleRow | undefined} */
    title: key => /** @type {any} */ (db.prepare('SELECT * FROM titles WHERE rating_key = ?').get(key)),
    /** @param {string} search @param {number} limit @returns {TitleRow[]} */
    searchTitles: (search, limit) =>
      /** @type {any} */ (
        db
          .prepare(
            `SELECT * FROM titles WHERE seen = 1 AND title LIKE ? ESCAPE '\\' ORDER BY title COLLATE NOCASE LIMIT ?`,
          )
          .all(`%${search.replace(/[\\%_]/g, c => '\\' + c)}%`, limit)
      ),

    /** @param {Array<{ id: string, voterId: string, titleKey: string, started: number, seconds: number, watched: boolean }>} plays */
    upsertPlays: plays =>
      tx(() => {
        for (const p of plays) q.upsertPlay.run(p.id, p.voterId, p.titleKey, p.started, p.seconds, p.watched ? 1 : 0);
      }),
    /** @returns {number} newest play start time (unix seconds), 0 when there are none */
    latestPlay: () => Number(/** @type {any} */ (db.prepare('SELECT MAX(started) AS m FROM plays').get()).m ?? 0),
    /** @param {string} titleKey @returns {PlayRow[]} */
    playsOf: titleKey => /** @type {any} */ (db.prepare('SELECT * FROM plays WHERE title_key = ?').all(titleKey)),
    /** @param {string} voterId @returns {Map<string, Array<{ seconds: number, watched: boolean }>>} by Title */
    playsBy: voterId => {
      const out = new Map();
      for (const p of /** @type {any[]} */ (db.prepare('SELECT * FROM plays WHERE voter_id = ?').all(voterId))) {
        const list = out.get(p.title_key) ?? [];
        list.push({ seconds: p.seconds, watched: !!p.watched });
        out.set(p.title_key, list);
      }
      return out;
    },
    /** @param {number} since unix seconds @returns {Map<string, number>} watch seconds per Voter since then */
    watchSecondsSince: since => {
      const rows = /** @type {any[]} */ (
        db
          .prepare(
            `SELECT v.plex_id AS id, COALESCE(SUM(p.seconds), 0) AS s FROM voters v
             LEFT JOIN plays p ON p.voter_id = v.plex_id AND p.started >= ? GROUP BY v.plex_id`,
          )
          .all(since)
      );
      return new Map(rows.map(r => [String(r.id), Number(r.s)]));
    },

    /** @param {string} voterId @param {string} titleKey @param {number} now @returns {boolean} false if one exists */
    addDownvote: (voterId, titleKey, now) =>
      db
        .prepare('INSERT INTO downvotes (voter_id, title_key, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
        .run(voterId, titleKey, now).changes === 1,
    /** @param {string} titleKey @returns {Array<{ voter_id: string, created_at: number }>} */
    downvotesOf: titleKey =>
      /** @type {any} */ (db.prepare('SELECT voter_id, created_at FROM downvotes WHERE title_key = ?').all(titleKey)),
    /** @param {string} voterId @returns {Set<string>} */
    downvotedBy: voterId =>
      new Set(
        db
          .prepare('SELECT title_key FROM downvotes WHERE voter_id = ?')
          .all(voterId)
          .map(r => String(r.title_key)),
      ),
    /** @returns {string[]} Titles with Downvotes that aren't queued yet */
    pendingTitles: () =>
      db
        .prepare(
          `SELECT DISTINCT d.title_key AS k FROM downvotes d
           LEFT JOIN review_queue r ON r.title_key = d.title_key WHERE r.title_key IS NULL`,
        )
        .all()
        .map(r => String(r.k)),

    /** @param {string} titleKey */
    isQueued: titleKey => !!db.prepare('SELECT 1 FROM review_queue WHERE title_key = ?').get(titleKey),
    // Queue a Title and freeze its Downvotes with the Vote Weight each had at that moment.
    /**
     * @param {string} titleKey @param {number} now
     * @param {{ audience: number, audienceWeight: number, downvoteWeight: number }} result
     * @param {Array<{ voterId: string, voteWeight: number, inAudience: boolean, createdAt: number }>} downvotes
     */
    enqueue: (titleKey, now, result, downvotes) =>
      tx(() => {
        db.prepare(
          `INSERT INTO review_queue (title_key, queued_at, audience, audience_weight, downvote_weight)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(titleKey, now, result.audience, result.audienceWeight, result.downvoteWeight);
        const ins = db.prepare(
          `INSERT INTO queued_downvotes (title_key, voter_id, vote_weight, in_audience, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const d of downvotes) ins.run(titleKey, d.voterId, d.voteWeight, d.inAudience ? 1 : 0, d.createdAt);
      }),
    /** @returns {any[]} */
    reviewQueue: () => db.prepare('SELECT * FROM review_queue ORDER BY queued_at').all(),
    /** @param {string} titleKey @returns {any[]} */
    queuedDownvotesOf: titleKey =>
      db
        .prepare(
          `SELECT q.voter_id, q.vote_weight, q.in_audience, q.created_at, v.username FROM queued_downvotes q
           LEFT JOIN voters v ON v.plex_id = q.voter_id WHERE q.title_key = ? ORDER BY q.vote_weight DESC`,
        )
        .all(titleKey),

    /** @param {string} token @param {string} plexId @param {boolean} isOwner @param {number} now */
    addSession: (token, plexId, isOwner, now) =>
      void db
        .prepare('INSERT INTO sessions (token, plex_id, is_owner, created_at) VALUES (?, ?, ?, ?)')
        .run(token, plexId, isOwner ? 1 : 0, now),
    /** @param {string} token @param {number} notBefore @returns {{ plexId: string, isOwner: boolean } | undefined} */
    session: (token, notBefore) => {
      const r = /** @type {any} */ (
        db.prepare('SELECT plex_id, is_owner FROM sessions WHERE token = ? AND created_at >= ?').get(token, notBefore)
      );
      return r && { plexId: String(r.plex_id), isOwner: !!r.is_owner };
    },
    /** @param {string} token */
    dropSession: token => void db.prepare('DELETE FROM sessions WHERE token = ?').run(token),

    /** @param {string} key @returns {string | undefined} */
    getSetting: key => /** @type {any} */ (q.getSetting.get(key))?.value,
    /** @param {string} key @param {string} value */
    setSetting: (key, value) => void q.setSetting.run(key, value),

    close: () => db.close(),
  };
}

/** @typedef {ReturnType<typeof openStore>} Store */

module.exports = { openStore };
