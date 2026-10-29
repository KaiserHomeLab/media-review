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
  title TEXT NOT NULL, year INTEGER, thumb TEXT, seen INTEGER NOT NULL DEFAULT 1, library TEXT,
  library_pos INTEGER, library_key TEXT, tmdb_id TEXT, tvdb_id TEXT
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
  audience INTEGER NOT NULL, audience_weight REAL NOT NULL, downvote_weight REAL NOT NULL,
  sent_back INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS objections (
  voter_id TEXT NOT NULL, title_key TEXT NOT NULL, created_at INTEGER NOT NULL, vote_weight REAL,
  PRIMARY KEY (voter_id, title_key)
);
CREATE TABLE IF NOT EXISTS queued_downvotes (
  title_key TEXT NOT NULL, voter_id TEXT NOT NULL, vote_weight REAL NOT NULL, in_audience INTEGER NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY (title_key, voter_id)
);
CREATE TABLE IF NOT EXISTS leaving_soon (
  title_key TEXT PRIMARY KEY, removed_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
  delete_error TEXT, deleted_from TEXT, objections_closed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS deletions (
  title_key TEXT NOT NULL, at INTEGER NOT NULL, deleted_from TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY, title_key TEXT NOT NULL, decision TEXT NOT NULL CHECK (decision IN ('keep', 'remove')),
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_title ON decisions (title_key);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, plex_id TEXT NOT NULL, is_owner INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/**
 * @typedef {{ plex_id: string, username: string, thumb: string | null }} VoterRow
 * @typedef {{ rating_key: string, kind: 'movie' | 'show', title: string, year: number | null,
 *   thumb: string | null, library: string | null, library_key: string | null,
 *   tmdb_id: string | null, tvdb_id: string | null }} TitleRow
 * @typedef {{ id: string, voter_id: string, title_key: string, started: number, seconds: number,
 *   watched: number }} PlayRow
 */

/** @param {string} file ':memory:' in tests */
function openStore(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // Columns added after the first release: add them to databases made before.
  /** @param {string} table @param {string} column @param {string} type */
  const addColumn = (table, column, type) => {
    const has = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some(c => c.name === column);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  addColumn('titles', 'library', 'TEXT'); // the Plex library: Movies, TV Shows, Anime…
  addColumn('titles', 'library_pos', 'INTEGER'); // its place in Plex's own list of libraries
  addColumn('titles', 'library_key', 'TEXT'); // the Plex library section id, where collections live
  addColumn('titles', 'tmdb_id', 'TEXT'); // how Radarr knows a movie
  addColumn('titles', 'tvdb_id', 'TEXT'); // how Sonarr knows a show
  addColumn('leaving_soon', 'delete_error', 'TEXT'); // why the last try to delete it failed
  addColumn('leaving_soon', 'deleted_from', 'TEXT'); // apps it's already gone from, if a try half-worked
  addColumn('review_queue', 'sent_back', 'INTEGER NOT NULL DEFAULT 0'); // back by Objections
  addColumn('leaving_soon', 'objections_closed', 'INTEGER NOT NULL DEFAULT 0'); // its second Leaving Soon

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
      `INSERT INTO titles (rating_key, kind, title, year, thumb, library, library_pos, library_key, tmdb_id, tvdb_id, seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT (rating_key) DO UPDATE SET kind = excluded.kind, title = excluded.title, year = excluded.year,
         thumb = excluded.thumb, library = excluded.library, library_pos = excluded.library_pos,
         library_key = excluded.library_key, tmdb_id = excluded.tmdb_id, tvdb_id = excluded.tvdb_id, seen = 1`,
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
    /**
     * @param {Array<{ ratingKey: string, kind: 'movie' | 'show', title: string, year?: number | null,
     *   thumb?: string | null, library?: string | null, libraryKey?: string | null,
     *   tmdbId?: string | null, tvdbId?: string | null }>} list
     */
    replaceTitles: list =>
      tx(() => {
        db.exec('UPDATE titles SET seen = 0');
        // Libraries keep the order Plex lists them in (the list comes library by library).
        const pos = new Map();
        for (const t of list) {
          if (t.library != null && !pos.has(t.library)) pos.set(t.library, pos.size);
          const p = t.library == null ? null : pos.get(t.library);
          q.upsertTitle.run(
            t.ratingKey,
            t.kind,
            t.title,
            t.year ?? null,
            t.thumb ?? null,
            t.library ?? null,
            p,
            t.libraryKey ?? null,
            t.tmdbId ?? null,
            t.tvdbId ?? null,
          );
        }
      }),
    // Plex library sections that hold Titles: each may need a Leaving Soon collection.
    /** @returns {Array<{ key: string, kind: 'movie' | 'show' }>} */
    librarySections: () =>
      db
        .prepare(
          'SELECT library_key AS k, MIN(kind) AS kind FROM titles WHERE seen = 1 AND library_key IS NOT NULL GROUP BY library_key',
        )
        .all()
        .map(r => ({ key: String(r.k), kind: /** @type {'movie' | 'show'} */ (r.kind) })),
    // The Plex libraries Titles are in, in Plex's order, for the Voter's tabs.
    /** @returns {Array<{ name: string, kind: 'movie' | 'show', count: number, key: string | null }>} */
    libraries: () =>
      db
        .prepare(
          `SELECT library AS name, MIN(kind) AS kind, COUNT(*) AS n, MIN(library_key) AS k FROM titles
           WHERE seen = 1 AND library IS NOT NULL GROUP BY library
           ORDER BY MIN(library_pos), library COLLATE NOCASE`,
        )
        .all()
        .map(r => ({
          name: String(r.name),
          kind: /** @type {'movie' | 'show'} */ (r.kind),
          count: Number(r.n),
          key: r.k == null ? null : String(r.k), // the Plex section id
        })),
    /** @param {string} key @returns {TitleRow | undefined} */
    title: key => /** @type {any} */ (db.prepare('SELECT * FROM titles WHERE rating_key = ?').get(key)),
    /** @param {string} search @param {number} limit @param {string} [library] only this Plex library @returns {TitleRow[]} */
    searchTitles: (search, limit, library) =>
      /** @type {any} */ (
        db
          .prepare(
            `SELECT * FROM titles WHERE seen = 1 AND title LIKE ? ESCAPE '\\' AND (? IS NULL OR library = ?)
             ORDER BY title COLLATE NOCASE LIMIT ?`,
          )
          .all(`%${search.replace(/[\\%_]/g, c => '\\' + c)}%`, library ?? null, library ?? null, limit)
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
    /** @param {string} voterId @param {string} titleKey @returns {boolean} false if there was none */
    removeDownvote: (voterId, titleKey) =>
      db.prepare('DELETE FROM downvotes WHERE voter_id = ? AND title_key = ?').run(voterId, titleKey).changes === 1,
    // Downvotes on Titles not yet queued whose Voter has since had a Watch of the Title.
    /** @returns {Array<{ voterId: string, titleKey: string }>} */
    downvotesWatchedSince: () =>
      db
        .prepare(
          `SELECT d.voter_id, d.title_key FROM downvotes d
           LEFT JOIN review_queue r ON r.title_key = d.title_key
           LEFT JOIN leaving_soon l ON l.title_key = d.title_key
           WHERE r.title_key IS NULL AND l.title_key IS NULL AND EXISTS (
             SELECT 1 FROM plays p WHERE p.voter_id = d.voter_id AND p.title_key = d.title_key
               AND p.watched = 1 AND p.started > d.created_at)`,
        )
        .all()
        .map(r => ({ voterId: String(r.voter_id), titleKey: String(r.title_key) })),
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
           LEFT JOIN review_queue r ON r.title_key = d.title_key
           LEFT JOIN leaving_soon l ON l.title_key = d.title_key
           WHERE r.title_key IS NULL AND l.title_key IS NULL`,
        )
        .all()
        .map(r => String(r.k)),

    /** @param {string} titleKey */
    isQueued: titleKey => !!db.prepare('SELECT 1 FROM review_queue WHERE title_key = ?').get(titleKey),
    /** @param {string} voterId @param {string} titleKey @param {number} now @returns {boolean} false if made already */
    addObjection: (voterId, titleKey, now) =>
      db
        .prepare('INSERT INTO objections (voter_id, title_key, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
        .run(voterId, titleKey, now).changes === 1,
    /** @param {string} voterId @param {string} titleKey @returns {boolean} false if there was none */
    removeObjection: (voterId, titleKey) =>
      db.prepare('DELETE FROM objections WHERE voter_id = ? AND title_key = ?').run(voterId, titleKey).changes === 1,
    /** @param {string} titleKey @returns {Array<{ voter_id: string, username: string | null, vote_weight: number | null }>} */
    objectionsOf: titleKey =>
      /** @type {any} */ (
        db
          .prepare(
            `SELECT o.voter_id, v.username, o.vote_weight FROM objections o
             LEFT JOIN voters v ON v.plex_id = o.voter_id WHERE o.title_key = ? ORDER BY o.vote_weight DESC, o.created_at`,
          )
          .all(titleKey)
      ),
    /** @param {string} voterId @returns {Set<string>} */
    objectedBy: voterId =>
      new Set(
        db
          .prepare('SELECT title_key FROM objections WHERE voter_id = ?')
          .all(voterId)
          .map(r => String(r.title_key)),
      ),
    /** @param {string} titleKey */
    isLeaving: titleKey => !!db.prepare('SELECT 1 FROM leaving_soon WHERE title_key = ?').get(titleKey),
    // Queue a Title and freeze its Downvotes with the Vote Weight each had at that moment.
    /**
     * @param {string} titleKey @param {number} now
     * @param {{ audience: number, audienceWeight: number, downvoteWeight: number }} result
     * @param {Array<{ voterId: string, voteWeight: number, inAudience: boolean, createdAt: number }>} downvotes
     * @param {Map<string, number>} [objections] sent back by these Objections (Voter → Vote Weight)
     */
    enqueue: (titleKey, now, result, downvotes, objections) =>
      tx(() => {
        if (objections) {
          db.prepare('DELETE FROM leaving_soon WHERE title_key = ?').run(titleKey);
          const w = db.prepare('UPDATE objections SET vote_weight = ? WHERE voter_id = ? AND title_key = ?');
          for (const [voter, weight] of objections) w.run(weight, voter, titleKey);
        }
        db.prepare(
          `INSERT INTO review_queue (title_key, queued_at, audience, audience_weight, downvote_weight, sent_back)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(titleKey, now, result.audience, result.audienceWeight, result.downvoteWeight, objections ? 1 : 0);
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

    // Watches of a queued Title by its downvoters since it was queued: the latest one each.
    /** @param {string} titleKey @returns {any[]} */
    watchedSinceQueued: titleKey =>
      db
        .prepare(
          `SELECT q.voter_id, v.username, MAX(p.started) AS at FROM queued_downvotes q
           JOIN review_queue r ON r.title_key = q.title_key
           JOIN plays p ON p.voter_id = q.voter_id AND p.title_key = q.title_key AND p.watched = 1
             AND p.started >= r.queued_at
           LEFT JOIN voters v ON v.plex_id = q.voter_id
           WHERE q.title_key = ? GROUP BY q.voter_id ORDER BY at`,
        )
        .all(titleKey),

    // Keep: the Title leaves the queue and starts again from zero Downvotes.
    /** @param {string} titleKey @param {number} now */
    keep: (titleKey, now) =>
      tx(() => {
        for (const table of ['review_queue', 'queued_downvotes', 'downvotes', 'leaving_soon', 'objections'])
          db.prepare(`DELETE FROM ${table} WHERE title_key = ?`).run(titleKey);
        db.prepare(`INSERT INTO decisions (title_key, decision, at) VALUES (?, 'keep', ?)`).run(titleKey, now);
      }),
    // Remove: the Title leaves the queue for Leaving Soon. Its Downvotes stay, frozen (Objections need them).
    /** @param {string} titleKey @param {number} now @param {number} endsAt */
    remove: (titleKey, now, endsAt) =>
      tx(() => {
        // Sent back by Objections once already: this Leaving Soon takes none.
        const back = /** @type {any} */ (
          db.prepare('SELECT sent_back FROM review_queue WHERE title_key = ?').get(titleKey)
        );
        for (const table of ['review_queue', 'queued_downvotes', 'objections'])
          db.prepare(`DELETE FROM ${table} WHERE title_key = ?`).run(titleKey);
        db.prepare(
          'INSERT INTO leaving_soon (title_key, removed_at, ends_at, objections_closed) VALUES (?, ?, ?, ?)',
        ).run(titleKey, now, endsAt, back?.sent_back ? 1 : 0);
        db.prepare(`INSERT INTO decisions (title_key, decision, at) VALUES (?, 'remove', ?)`).run(titleKey, now);
      }),
    /**
     * @returns {Array<{ title_key: string, removed_at: number, ends_at: number, delete_error: string | null,
     *   deleted_from: string | null, objections_closed: number }>} soonest first
     */
    leavingSoon: () => /** @type {any} */ (db.prepare('SELECT * FROM leaving_soon ORDER BY ends_at, title_key').all()),
    // A try to delete it didn't finish: why, and the apps it is already gone from (comma-separated).
    /** @param {string} titleKey @param {string} error @param {string[]} deletedFrom */
    deleteFailed: (titleKey, error, deletedFrom) =>
      void db
        .prepare('UPDATE leaving_soon SET delete_error = ?, deleted_from = ? WHERE title_key = ?')
        .run(error, deletedFrom.join(',') || null, titleKey),
    // Deleted: it leaves Leaving Soon and the catalogue. Its decisions stay as its history.
    /** @param {string} titleKey @param {number} now @param {string[]} deletedFrom */
    deleted: (titleKey, now, deletedFrom) =>
      tx(() => {
        for (const table of ['leaving_soon', 'downvotes', 'objections'])
          db.prepare(`DELETE FROM ${table} WHERE title_key = ?`).run(titleKey);
        db.prepare('INSERT INTO deletions (title_key, at, deleted_from) VALUES (?, ?, ?)').run(
          titleKey,
          now,
          deletedFrom.join(','),
        );
        db.prepare('UPDATE titles SET seen = 0 WHERE rating_key = ?').run(titleKey);
      }),
    /** @param {string} titleKey @returns {Array<{ at: number, deleted_from: string }>} */
    deletionsOf: titleKey =>
      /** @type {any} */ (
        db.prepare('SELECT at, deleted_from FROM deletions WHERE title_key = ? ORDER BY at').all(titleKey)
      ),
    /** @param {string} titleKey @returns {Array<{ decision: 'keep' | 'remove', at: number }>} */
    decisionsOf: titleKey =>
      /** @type {any} */ (
        db.prepare('SELECT decision, at FROM decisions WHERE title_key = ? ORDER BY at').all(titleKey)
      ),

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
