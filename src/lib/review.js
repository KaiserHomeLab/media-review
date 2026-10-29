// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Applies the rules to what the store holds: casting a Downvote, checking a Title against the
// threshold, and building the Review Queue that Media Ops shows.
'use strict';
const {
  hasSampled,
  sampleKind,
  baseWeights,
  voteWeight,
  checkThreshold,
  checkObjections,
  quietTime,
} = require('./rules');

/** @typedef {import('./rules').Settings} Settings @typedef {import('./store').Store} Store */

const DAY = 86400;

/** @param {Store} store @param {Settings} s @param {number} now unix seconds */
const currentBaseWeights = (store, s, now) => baseWeights(store.watchSecondsSince(now - s.baseWeightDays * DAY));

// Everyone with a say on a Title: each Voter who played it, plus `also` (who Downvoted or objected), with
// their Base Weight and whether they've Sampled it.
/**
 * @param {Store} store @param {Settings} s @param {import('./store').TitleRow} title
 * @param {Map<string, number>} bases @param {string[]} also
 */
function votersOf(store, s, title, bases, also) {
  /** @type {Map<string, Array<{ seconds: number, watched: boolean }>>} */
  const playsByVoter = new Map();
  for (const p of store.playsOf(title.rating_key)) {
    if (!bases.has(p.voter_id)) continue; // not a Voter (the Owner, or someone no longer shared with)
    const list = playsByVoter.get(p.voter_id) ?? [];
    list.push({ seconds: p.seconds, watched: !!p.watched });
    playsByVoter.set(p.voter_id, list);
  }
  const ids = new Set([...playsByVoter.keys(), ...also]);
  return [...ids].map(id => ({
    id,
    baseWeight: bases.get(id) ?? 0,
    sampled: hasSampled(sampleKind(title, s), playsByVoter.get(id) ?? [], s),
  }));
}

// Put a Title in the Review Queue with its Downvotes frozen at their Vote Weight now. Sent back by
// Objections, it also leaves Leaving Soon and keeps who objected, with their weight.
/**
 * @param {Store} store @param {Settings} s @param {import('./store').TitleRow} title @param {number} now
 * @param {ReturnType<typeof votersOf>} voters @param {ReturnType<typeof checkThreshold>} result
 * @param {Map<string, number>} [objections]
 */
function enqueue(store, s, title, now, voters, result, objections) {
  const byId = new Map(voters.map(v => [v.id, v]));
  store.enqueue(
    title.rating_key,
    now,
    result,
    store.downvotesOf(title.rating_key).map(d => {
      const v = /** @type {{ baseWeight: number, sampled: boolean }} */ (byId.get(d.voter_id));
      return {
        voterId: d.voter_id,
        voteWeight: voteWeight(v.baseWeight, v.sampled, s),
        inAudience: v.sampled,
        createdAt: d.created_at,
      };
    }),
    objections,
  );
}

// Check one Title and queue it if it has reached the threshold. Queued Titles are left alone:
// their Downvotes are frozen.
/** @param {Store} store @param {Settings} s @param {string} titleKey @param {number} now @param {Map<string, number>} [bases] */
function evaluate(store, s, titleKey, now, bases = currentBaseWeights(store, s, now)) {
  const title = store.title(titleKey);
  if (!title || store.isQueued(titleKey) || store.isLeaving(titleKey)) return false;
  const downvoters = store.downvotesOf(titleKey).map(d => d.voter_id);
  const voters = votersOf(store, s, title, bases, downvoters);
  const result = checkThreshold(voters, new Set(downvoters), s);
  if (!result.reached) return false;
  enqueue(store, s, title, now, voters, result);
  return true;
}

// An Objection, while a Title is Leaving Soon: "send it back to the Owner". It weighs what this Voter's
// Downvote would; once the Objections reach the Objection bar, the Title goes back to the Review Queue.
/**
 * @param {Store} store @param {Settings} s @param {string} voterId @param {string} titleKey @param {number} now
 * @returns {{ ok: true, sentBack: boolean }
 *   | { ok: false, error: 'not-leaving' | 'objections-closed' | 'downvoted' | 'already-objected' }}
 */
function object(store, s, voterId, titleKey, now) {
  const leaving = store.leavingSoon().find(l => l.title_key === titleKey);
  const title = store.title(titleKey);
  if (!leaving || !title) return { ok: false, error: 'not-leaving' };
  // Sent back once already, and Removed again: this Leaving Soon takes no Objections.
  if (leaving.objections_closed) return { ok: false, error: 'objections-closed' };
  // They asked for it to go; they can't also ask for it to stay.
  if (store.downvotedBy(voterId).has(titleKey)) return { ok: false, error: 'downvoted' };
  if (!store.addObjection(voterId, titleKey, now)) return { ok: false, error: 'already-objected' };

  const objectors = store.objectionsOf(titleKey).map(o => o.voter_id);
  const downvoters = store.downvotesOf(titleKey).map(d => d.voter_id);
  const voters = votersOf(store, s, title, currentBaseWeights(store, s, now), [...objectors, ...downvoters]);
  const byId = new Map(voters.map(v => [v.id, v]));
  const theirs = objectors.map(id => /** @type {{ baseWeight: number, sampled: boolean }} */ (byId.get(id)));
  if (!checkObjections(theirs, s).reached) return { ok: true, sentBack: false };

  const weights = new Map(objectors.map((id, i) => [id, voteWeight(theirs[i].baseWeight, theirs[i].sampled, s)]));
  enqueue(store, s, title, now, voters, checkThreshold(voters, new Set(downvoters), s), weights);
  return { ok: true, sentBack: true };
}

/** @param {Store} store @param {string} voterId @param {string} titleKey */
function withdrawObjection(store, voterId, titleKey) {
  if (!store.isLeaving(titleKey)) return { ok: false, error: 'not-leaving' };
  return store.removeObjection(voterId, titleKey) ? { ok: true } : { ok: false, error: 'not-objected' };
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
/** @param {Store} store @param {number} now @param {{ owner?: boolean, settings?: Settings }} [opts] */
function leavingSoon(store, now, opts = {}) {
  const s = opts.settings;
  const bases = opts.owner && s ? currentBaseWeights(store, s, now) : null;
  return store.leavingSoon().map(l => {
    const t = store.title(l.title_key);
    // For the Owner: who has objected so far, and how close that is to sending it back.
    let standing = {};
    if (bases && s && t) {
      const objectors = store.objectionsOf(l.title_key);
      const voters = new Map(
        votersOf(
          store,
          s,
          t,
          bases,
          objectors.map(o => o.voter_id),
        ).map(v => [v.id, v]),
      );
      const theirs = objectors.map(o => ({
        voter: o.username ?? o.voter_id,
        voteWeight: round(voteWeight(voters.get(o.voter_id)?.baseWeight ?? 0, !!voters.get(o.voter_id)?.sampled, s)),
      }));
      standing = {
        objections: theirs,
        objectionWeight: round(theirs.reduce((sum, o) => sum + o.voteWeight, 0)),
        objectionBar: s.objectionBar,
      };
    }
    return {
      ratingKey: l.title_key,
      kind: t?.kind,
      name: t?.title,
      year: t?.year ?? null,
      library: t?.library ?? null,
      removedAt: iso(l.removed_at),
      endsAt: iso(l.ends_at),
      daysLeft: Math.max(0, Math.ceil((l.ends_at - now) / DAY)),
      // Sent back once already and Removed again: no Objections this time.
      objectionsOpen: !l.objections_closed,
      ...(opts.owner ? { deleteError: l.delete_error ?? null, ...standing } : {}),
    };
  });
}

// Which Titles one Voter has Sampled: their Downvote only counts on those (Q5), and they're told so.
/** @param {Store} store @param {Settings} s @param {string} voterId */
function sampledBy(store, s, voterId) {
  const plays = store.playsBy(voterId);
  return (/** @type {{ rating_key: string, kind: 'movie' | 'show', library_key?: string | null }} */ t) =>
    hasSampled(sampleKind(t, s), plays.get(t.rating_key) ?? [], s);
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
      sentBack: !!r.sent_back,
      // Who sent it back, with the weight each Objection carried. Only the Owner sees this.
      objections: store.objectionsOf(r.title_key).map(o => ({
        voter: o.username ?? o.voter_id,
        voteWeight: round(o.vote_weight ?? 0),
      })),
      history: store.decisionsOf(r.title_key).map(d => ({ decision: d.decision, at: iso(d.at) })),
    };
  });
}

/** @param {number} t unix seconds */
const iso = t => new Date(t * 1000).toISOString();
/** @param {number} n */
const round = n => Math.round(n * 100) / 100;

module.exports = {
  object,
  withdrawObjection,
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
