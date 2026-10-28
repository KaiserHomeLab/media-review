// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Applies the rules to what the store holds: casting a Downvote, checking a Title against the
// threshold, and building the Review Queue that Media Ops shows.
'use strict';
const { hasSampled, baseWeights, voteWeight, checkThreshold } = require('./rules');

/** @typedef {import('./rules').Settings} Settings @typedef {import('./store').Store} Store */

const DAY = 86400;

/** @param {Store} store @param {Settings} s @param {number} now unix seconds */
const currentBaseWeights = (store, s, now) => baseWeights(store.watchSecondsSince(now - s.baseWeightDays * DAY));

// Check one Title and queue it if it has reached the threshold. Queued Titles are left alone:
// their Downvotes are frozen.
/** @param {Store} store @param {Settings} s @param {string} titleKey @param {number} now @param {Map<string, number>} [bases] */
function evaluate(store, s, titleKey, now, bases = currentBaseWeights(store, s, now)) {
  const title = store.title(titleKey);
  if (!title || store.isQueued(titleKey)) return false;

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
 * @returns {{ ok: true, queued: boolean } | { ok: false, error: 'unknown-title' | 'already-downvoted' | 'queued' }}
 */
function castDownvote(store, s, voterId, titleKey, now) {
  if (!store.title(titleKey)) return { ok: false, error: 'unknown-title' };
  if (store.isQueued(titleKey)) return { ok: false, error: 'queued' };
  if (!store.addDownvote(voterId, titleKey, now)) return { ok: false, error: 'already-downvoted' };
  return { ok: true, queued: evaluate(store, s, titleKey, now) };
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
      // Filled in by later tickets: Watches by downvoters after queuing (0002), sent back by Objections (0006),
      // and earlier Keep/Remove decisions (0003, 0004).
      watchedSinceQueued: [],
      sentBack: false,
      history: [],
    };
  });
}

/** @param {number} n */
const round = n => Math.round(n * 100) / 100;

module.exports = { evaluate, evaluateAll, castDownvote, sampledBy, reviewQueue };
