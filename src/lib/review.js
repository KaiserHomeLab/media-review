// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Applies the rules to what the store holds: casting a Downvote, checking a Title against the
// threshold, and building the Review Queue that Media Ops shows.
'use strict';
const { hasSampled, baseWeights, voteWeight, checkThreshold, quietTime } = require('./rules');

/** @typedef {import('./rules').Settings} Settings @typedef {import('./store').Store} Store */

const DAY = 86400;

/** @param {Store} store @param {Settings} s @param {number} now unix seconds */
const currentBaseWeights = (store, s, now) => baseWeights(store.watchSecondsSince(now - s.baseWeightDays * DAY));

// Check one Title and queue it if it has reached the threshold. Queued Titles are left alone:
// their Downvotes are frozen.
/** @param {Store} store @param {Settings} s @param {string} titleKey @param {number} now @param {Map<string, number>} [bases] */
function evaluate(store, s, titleKey, now, bases = currentBaseWeights(store, s, now)) {
  const title = store.title(titleKey);
  if (!title || store.isQueued(titleKey) || store.isLeaving(titleKey)) return false;

  /** @type {Map<string, Array<{ seconds: number, watched: boolean }>>} */
  const playsByVoter = new Map();
  for (const p of store.playsOf(titleKey)) {
    if (!bases.has(p.voter_id)) continue; // not a Voter (the Owner, or someone no longer shared with)
    const list = playsByVoter.get(p.voter_id) ?? [];
    list.push({ seconds: p.seconds, watched: !!p.watched });
    playsByVoter.set(p.voter_id, list);
  }
  const downvotes = store.downvotesOf(titleKey);
  const ids = new Set([...playsByVoter.keys(), ...downvotes.map(d => d.voter_id)]);
  const voters = [...ids].map(id => ({
    id,
    baseWeight: bases.get(id) ?? 0,
    sampled: hasSampled(title.kind, playsByVoter.get(id) ?? [], s),
  }));

  const result = checkThreshold(voters, new Set(downvotes.map(d => d.voter_id)), s);
  if (!result.reached) return false;
  const byId = new Map(voters.map(v => [v.id, v]));
  store.enqueue(
    titleKey,
    now,
    result,
    downvotes.map(d => {
      const v = /** @type {{ baseWeight: number, sampled: boolean }} */ (byId.get(d.voter_id));
      return {
        voterId: d.voter_id,
        voteWeight: voteWeight(v.baseWeight, v.sampled, s),
        inAudience: v.sampled,
        createdAt: d.created_at,
      };
    }),
  );
  return true;
}

// Re-check every Title with Downvotes that isn't queued yet, e.g. after new play history.
/** @param {Store} store @param {Settings} s @param {number} now @returns {string[]} newly queued Title keys */
function evaluateAll(store, s, now) {
  const bases = currentBaseWeights(store, s, now);
  return store.pendingTitles().filter(key => evaluate(store, s, key, now, bases));
}

/**
 * @param {Store} store @param {Settings} s @param {string} voterId @param {string} titleKey @param {number} now
 * @returns {{ ok: true, queued: boolean } | { ok: false, error: 'unknown-title' | 'already-downvoted' | 'queued' | 'leaving' }}
 */
function castDownvote(store, s, voterId, titleKey, now) {
  if (!store.title(titleKey)) return { ok: false, error: 'unknown-title' };
  if (store.isQueued(titleKey)) return { ok: false, error: 'queued' };
  if (store.isLeaving(titleKey)) return { ok: false, error: 'leaving' };
  if (!store.addDownvote(voterId, titleKey, now)) return { ok: false, error: 'already-downvoted' };
  return { ok: true, queued: evaluate(store, s, titleKey, now) };
}

/**
 * @param {Store} store @param {Settings} s @param {string} voterId @param {string} titleKey @param {number} now
 * @returns {{ ok: true } | { ok: false, error: 'not-downvoted' | 'queued' | 'leaving' }}
 */
function withdrawDownvote(store, s, voterId, titleKey, now) {
  if (store.isQueued(titleKey)) return { ok: false, error: 'queued' };
  if (store.isLeaving(titleKey)) return { ok: false, error: 'leaving' };
  if (!store.removeDownvote(voterId, titleKey)) return { ok: false, error: 'not-downvoted' };
  evaluate(store, s, titleKey, now);
  return { ok: true };
}

// A Watch of the Title after a Downvote withdraws it, until the Title is queued. Run after each sync.
/** @param {Store} store @returns {Array<{ voterId: string, titleKey: string }>} the withdrawn Downvotes */
function applyWatches(store) {
  const watched = store.downvotesWatchedSince();
  for (const d of watched) store.removeDownvote(d.voterId, d.titleKey);
  return watched;
}

// The Owner's Keep, from the Review Queue or, as "Keep after all", while the Title is Leaving Soon.
/** @param {Store} store @param {string} titleKey @param {number} now @returns {{ ok: true } | { ok: false, error: 'not-queued' }} */
function keep(store, titleKey, now) {
  if (!store.isQueued(titleKey) && !store.isLeaving(titleKey)) return { ok: false, error: 'not-queued' };
  store.keep(titleKey, now);
  return { ok: true };
}

// The Owner's Remove: Leaving Soon for the Leaving Soon length, never straight to deletion.
/**
 * @param {Store} store @param {Settings} s @param {string} titleKey @param {number} now
 * @returns {{ ok: true, endsAt: number } | { ok: false, error: 'not-queued' }}
 */
function remove(store, s, titleKey, now) {
  if (!store.isQueued(titleKey)) return { ok: false, error: 'not-queued' };
  // It ends overnight, so the day friends are shown is the night it goes.
  const endsAt = quietTime(now + s.leavingSoonDays * DAY, s.deleteHour);
  store.remove(titleKey, now, endsAt);
  return { ok: true, endsAt };
}

// Everything Leaving Soon, soonest first. Shown to everyone, so it never says who Downvoted. The Owner
// (and Media Ops) also see why a deletion failed.
/** @param {Store} store @param {number} now @param {{ owner?: boolean }} [opts] */
function leavingSoon(store, now, opts = {}) {
  return store.leavingSoon().map(l => {
    const t = store.title(l.title_key);
    return {
      ratingKey: l.title_key,
      kind: t?.kind,
      name: t?.title,
      year: t?.year ?? null,
      library: t?.library ?? null,
      removedAt: iso(l.removed_at),
      endsAt: iso(l.ends_at),
      daysLeft: Math.max(0, Math.ceil((l.ends_at - now) / DAY)),
      ...(opts.owner ? { deleteError: l.delete_error ?? null } : {}),
    };
  });
}

// Which Titles one Voter has Sampled: their Downvote only counts on those (Q5), and they're told so.
/** @param {Store} store @param {Settings} s @param {string} voterId */
function sampledBy(store, s, voterId) {
  const plays = store.playsBy(voterId);
  return (/** @type {{ rating_key: string, kind: 'movie' | 'show' }} */ t) =>
    hasSampled(t.kind, plays.get(t.rating_key) ?? [], s);
}

// What Media Ops shows. Only the Owner reaches this (through the API key), so it names each Voter.
/** @param {Store} store */
function reviewQueue(store) {
  return store.reviewQueue().map(r => {
    const t = store.title(r.title_key);
    return {
      title: {
        ratingKey: r.title_key,
        kind: t?.kind,
        name: t?.title,
        year: t?.year ?? null,
        library: t?.library ?? null,
        // Relative to Media Review's address, with the same API key.
        poster: t?.thumb ? `/api/v1/poster/${encodeURIComponent(r.title_key)}` : null,
      },
      queuedAt: new Date(r.queued_at * 1000).toISOString(),
      audience: r.audience,
      audienceWeight: round(r.audience_weight),
      downvoteWeight: round(r.downvote_weight),
      downvotes: store.queuedDownvotesOf(r.title_key).map(d => ({
        voter: d.username ?? d.voter_id,
        voteWeight: round(d.vote_weight),
        inAudience: !!d.in_audience,
        at: new Date(d.created_at * 1000).toISOString(),
      })),
      // Frozen Downvotes stay, but the Owner sees who has watched the Title since.
      watchedSinceQueued: store
        .watchedSinceQueued(r.title_key)
        .map(w => ({ voter: w.username ?? w.voter_id, at: iso(w.at) })),
      sentBack: false, // set by Objections (0006)
      history: store.decisionsOf(r.title_key).map(d => ({ decision: d.decision, at: iso(d.at) })),
    };
  });
}

/** @param {number} t unix seconds */
const iso = t => new Date(t * 1000).toISOString();
/** @param {number} n */
const round = n => Math.round(n * 100) / 100;

module.exports = {
  remove,
  leavingSoon,
  evaluate,
  evaluateAll,
  castDownvote,
  withdrawDownvote,
  applyWatches,
  keep,
  sampledBy,
  reviewQueue,
};
