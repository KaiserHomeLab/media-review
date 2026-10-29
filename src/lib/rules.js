// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// The downvote rules, as pure functions: Sample, Base Weight, Vote Weight and the threshold that
// sends a Title to the Review Queue. Terms are as defined in CONTEXT.md.
'use strict';

/**
 * @typedef {'movie' | 'show'} Kind
 * @typedef {Kind | 'anime'} SampleKind how long a Sample takes: anime is a show in an anime library
 * @typedef {{ sampleMovieMinutes: number, sampleShowMinutes: number, sampleAnimeMinutes: number,
 *   animeLibraries: string[], minimumAudience: number, downvoteShare: number, baseWeightDays: number,
 *   titleBonus: number, leavingSoonDays: number, deleteHour: number, objectionBar: number }} Settings
 *   animeLibraries: the Plex library section ids the Owner marked as anime
 * @typedef {{ seconds: number, watched: boolean }} Play
 * @typedef {{ id: string, baseWeight: number, sampled: boolean }} Voter
 */

/** @type {Settings} */
const DEFAULTS = {
  sampleMovieMinutes: 30,
  sampleShowMinutes: 10,
  sampleAnimeMinutes: 10,
  animeLibraries: [],
  minimumAudience: 3,
  downvoteShare: 0.5,
  baseWeightDays: 90,
  titleBonus: 2,
  leavingSoonDays: 14,
  deleteHour: 4, // overnight, server time: Leaving Soon ends then, and deletions run then
  objectionBar: 2, // one friend who tried it can send a Title back (the Owner's choice)
};

// Which Sample length a Title uses: anime is a show in a library the Owner marked as anime.
/** @param {{ kind: Kind, library_key?: string | null }} title @param {Settings} s @returns {SampleKind} */
const sampleKind = (title, s) =>
  title.kind === 'show' && title.library_key != null && s.animeLibraries.includes(title.library_key)
    ? 'anime'
    : title.kind;

/** @param {SampleKind} kind @param {Settings} s */
const sampleMinutes = (kind, s) =>
  kind === 'movie' ? s.sampleMovieMinutes : kind === 'anime' ? s.sampleAnimeMinutes : s.sampleShowMinutes;

// A Sample: play time on the Title adds up to the Sample length for its kind, or any play is a Watch.
/** @param {SampleKind} kind @param {Play[]} plays @param {Settings} s */
function hasSampled(kind, plays, s) {
  if (plays.some(p => p.watched)) return true;
  const minutes = sampleMinutes(kind, s);
  return plays.reduce((sum, p) => sum + p.seconds, 0) >= minutes * 60;
}

// Base Weight: each Voter's watch time in the window over the heaviest Voter's, so 0 to 1 (Q4 in the spec).
/** @param {Map<string, number>} secondsByVoter @returns {Map<string, number>} */
function baseWeights(secondsByVoter) {
  const most = Math.max(0, ...secondsByVoter.values());
  return new Map([...secondsByVoter].map(([id, s]) => [id, most > 0 ? s / most : 0]));
}

/** @param {number} base @param {boolean} sampled @param {Settings} s */
const voteWeight = (base, sampled, s) => base + (sampled ? s.titleBonus : 0);

// The Audience is the Voters who Sampled the Title. Only their Downvotes count toward the share (Q5);
// other Downvotes are kept and start counting once that Voter Samples the Title.
/** @param {Voter[]} voters @param {Set<string>} downvoters @param {Settings} s */
function checkThreshold(voters, downvoters, s) {
  const audience = voters.filter(v => v.sampled);
  const weigh = (/** @type {Voter[]} */ vs) => vs.reduce((sum, v) => sum + voteWeight(v.baseWeight, true, s), 0);
  const audienceWeight = weigh(audience);
  const downvoteWeight = weigh(audience.filter(v => downvoters.has(v.id)));
  const reached =
    audience.length >= s.minimumAudience && audienceWeight > 0 && downvoteWeight >= s.downvoteShare * audienceWeight;
  return { audience: audience.length, audienceWeight, downvoteWeight, reached };
}

// Deletions happen overnight. Leaving Soon ends at the first `hour`:00, server time, at or after `t`.
/** @param {number} t unix seconds @param {number} hour 0-23 @returns {number} unix seconds */
function quietTime(t, hour) {
  const d = new Date(t * 1000);
  const q = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour);
  if (q.getTime() < d.getTime()) q.setDate(q.getDate() + 1);
  return Math.floor(q.getTime() / 1000);
}

// Deletions run only in the three hours from `hour`:00. A missed night waits for the next one.
/** @param {number} t unix seconds @param {number} hour */
const inQuietWindow = (t, hour) => {
  const h = new Date(t * 1000).getHours();
  return h >= hour && h < hour + 3;
};

// Objections carry the Vote Weight each Voter's Downvote would. They send a Title back once their total
// reaches the Objection bar: a fixed amount, whatever the Audience.
/** @param {Array<{ baseWeight: number, sampled: boolean }>} objectors @param {Settings} s */
function checkObjections(objectors, s) {
  const weight = objectors.reduce((sum, v) => sum + voteWeight(v.baseWeight, v.sampled, s), 0);
  return { weight, reached: weight >= s.objectionBar };
}

module.exports = {
  DEFAULTS,
  checkObjections,
  sampleKind,
  sampleMinutes,
  hasSampled,
  baseWeights,
  voteWeight,
  checkThreshold,
  quietTime,
  inQuietWindow,
};
