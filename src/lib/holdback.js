// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Holding back deleted Titles (ticket 0008). Seerr can't send one Title's requests to the Owner, so a deleted
// Title goes on Seerr's blocklist, where nobody can request it, and stays there until the Owner brings it back.
// Friends see it under Gone in Media Review and ask for it there; the Owner sees each ask with the Title's
// history (its Downvotes, Objections, Keeps and Removes) and brings it back or declines, with an optional note.
// Bringing it back takes it off the blocklist and requests it in Seerr, approved.
'use strict';

/** @typedef {import('./store').Store} Store */
/** @typedef {import('./seerr').Seerr} Seerr */

const NOTE_MAX = 500;
const SHOW_DECIDED_DAYS = 30;

/** @param {unknown} v @returns {string | null} */
const noteOf = v =>
  String(v ?? '')
    .trim()
    .slice(0, NOTE_MAX) || null;
/** @param {number} t unix seconds */
const iso = t => new Date(t * 1000).toISOString();
/** @param {number} n */
const round = n => Math.round(n * 100) / 100;

// How Seerr knows a Title: its TMDB id, which Plex gives for movies and (nearly always) shows.
/** @param {import('./store').TitleRow} t */
const seerrMedia = t =>
  t.tmdb_id && /^\d+$/.test(t.tmdb_id)
    ? { tmdbId: Number(t.tmdb_id), mediaType: /** @type {'movie' | 'tv'} */ (t.kind === 'movie' ? 'movie' : 'tv') }
    : null;

// Put every held-back Title that isn't yet on Seerr's blocklist there. Runs after each sync, so one that
// failed (Seerr down, not set up yet) is tried again. Without Seerr nothing is blocked, and the Owner is told.
/** @param {{ store: Store, seerr: Seerr | null, log: (msg: string) => void }} ctx @returns {Promise<string[]>} blocked */
async function holdBack({ store, seerr, log }) {
  const done = [];
  for (const h of store.heldBack().filter(x => !x.blocked)) {
    const t = store.title(h.title_key);
    const m = t && seerrMedia(t);
    /** @param {string} why */
    const stop = why => {
      if (h.block_error !== why) log(`Could not hold back ${t?.title ?? h.title_key} in Seerr: ${why}`);
      store.setBlocked(h.title_key, why);
    };
    if (!seerr) {
      stop('Seerr is not set up in Media Review, so it can still be requested there');
      continue;
    }
    if (!t || !m) {
      stop("Plex has no TMDB id for it, so Seerr can't be told");
      continue;
    }
    try {
      await seerr.block({ ...m, title: t.title });
      store.setBlocked(h.title_key, null);
      done.push(h.title_key);
      log(`Held back ${t.title}: on Seerr's blocklist until you bring it back`);
    } catch (e) {
      stop(e.message);
    }
  }
  return done;
}

// What a Voter sees under Gone: each held-back Title, and whether they've asked for it. Never who else has.
/** @param {Store} store @param {string} voterId */
function gone(store, voterId) {
  return store.heldBack().map(h => {
    const t = store.title(h.title_key);
    return {
      ratingKey: h.title_key,
      kind: t?.kind,
      title: t?.title ?? 'Unknown title',
      year: t?.year ?? null,
      library: t?.library ?? null,
      poster: t?.thumb ? `/poster/${encodeURIComponent(h.title_key)}` : null,
      deletedAt: iso(h.since),
      asked: store.openAsksOf(h.title_key).some(a => a.voter_id === voterId),
    };
  });
}

/** @param {Store} store @param {string} voterId @param {string} titleKey @param {unknown} note @param {number} now */
function ask(store, voterId, titleKey, note, now) {
  if (!store.isHeldBack(titleKey)) return { ok: false, error: 'not-gone' };
  if (!store.addAsk(titleKey, voterId, noteOf(note), now)) return { ok: false, error: 'already-asked' };
  return { ok: true };
}

/** @param {Store} store @param {string} voterId @param {string} titleKey */
function withdrawAsk(store, voterId, titleKey) {
  return store.removeAsk(titleKey, voterId) ? { ok: true } : { ok: false, error: 'not-asked' };
}

// A Voter's own asks, and what the Owner did with each (for 30 days).
/** @param {Store} store @param {string} voterId @param {number} now */
function asksBy(store, voterId, now) {
  return store.asksBy(voterId, now - SHOW_DECIDED_DAYS * 86400).map(a => {
    const t = store.title(a.title_key);
    return {
      ratingKey: a.title_key,
      title: t?.title ?? 'Unknown title',
      year: t?.year ?? null,
      note: a.note,
      askedAt: iso(a.created_at),
      outcome: a.outcome,
      ownerNote: a.owner_note,
      decidedAt: a.decided_at == null ? null : iso(a.decided_at),
    };
  });
}

// A Title's history, for the Owner deciding whether to bring it back.
/** @param {Store} store @param {string} titleKey */
function historyOf(store, titleKey) {
  /** @type {Map<number, { at: string, downvotes: any[], objections: any[] }>} */
  const rounds = new Map();
  for (const v of store.votesOf(titleKey)) {
    const r = rounds.get(v.at) ?? { at: iso(v.at), downvotes: [], objections: [] };
    (v.kind === 'downvote' ? r.downvotes : r.objections).push({
      voter: v.username ?? v.voter_id,
      voteWeight: v.vote_weight == null ? null : round(v.vote_weight), // an Objection is weighed only on a send-back
    });
    rounds.set(v.at, r);
  }
  return {
    decisions: store.decisionsOf(titleKey).map(d => ({ decision: d.decision, at: iso(d.at) })),
    deletions: store.deletionsOf(titleKey).map(d => ({ at: iso(d.at), from: d.deleted_from.split(',') })),
    votes: [...rounds.values()],
  };
}

// The Owner's list (and Media Ops'): every held-back Title, the ones friends have asked for first.
/** @param {Store} store */
function heldBackList(store) {
  const list = store.heldBack().map(h => {
    const t = store.title(h.title_key);
    return {
      title: {
        ratingKey: h.title_key,
        kind: t?.kind,
        name: t?.title,
        year: t?.year ?? null,
        library: t?.library ?? null,
        poster: t?.thumb ? `/api/v1/poster/${encodeURIComponent(h.title_key)}` : null,
      },
      deletedAt: iso(h.since),
      blocked: !!h.blocked, // on Seerr's blocklist
      blockError: h.block_error,
      asks: store
        .openAsksOf(h.title_key)
        .map(a => ({ voter: a.username ?? a.voter_id, note: a.note, at: iso(a.created_at) })),
      history: historyOf(store, h.title_key),
    };
  });
  // Asked for first, oldest ask first; then the rest, newest deletion first.
  const firstAsk = (/** @type {typeof list[number]} */ x) => (x.asks.length ? x.asks[0].at : null);
  return [
    ...list.filter(firstAsk).sort((a, b) => String(firstAsk(a)).localeCompare(String(firstAsk(b)))),
    ...list.filter(x => !firstAsk(x)),
  ];
}

// Bring it back: off Seerr's blocklist and requested there, approved. Everyone who asked is told.
/**
 * @param {Store} store @param {Seerr | null} seerr @param {string} titleKey @param {unknown} note @param {number} now
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function bringBack(store, seerr, titleKey, note, now) {
  if (!store.isHeldBack(titleKey)) return { ok: false, error: 'not-gone' };
  if (!seerr) return { ok: false, error: 'Add Seerr under Settings first: it is what brings a Title back.' };
  const t = store.title(titleKey);
  const m = t && seerrMedia(t);
  if (!m) return { ok: false, error: "Plex has no TMDB id for it, so Seerr can't request it. Request it yourself." };
  await seerr.unblock(m);
  try {
    await seerr.request(m);
  } catch (e) {
    // Off the blocklist but not requested: it's still held back, and the next sync blocklists it again.
    store.setBlocked(titleKey, `brought back, but Seerr didn't take the request (${e.message})`);
    throw e;
  }
  store.release(titleKey, noteOf(note), now);
  return { ok: true };
}

/** @param {Store} store @param {string} titleKey @param {unknown} note @param {number} now */
function decline(store, titleKey, note, now) {
  if (!store.isHeldBack(titleKey)) return { ok: false, error: 'not-gone' };
  return store.declineAsks(titleKey, noteOf(note), now) ? { ok: true } : { ok: false, error: 'no-asks' };
}

module.exports = { holdBack, gone, ask, withdrawAsk, asksBy, heldBackList, historyOf, bringBack, decline };
