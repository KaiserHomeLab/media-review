// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// The downvote rules, as pure functions: Sample, Base Weight, Vote Weight and the threshold that
// sends a Title to the Review Queue. Terms are as defined in CONTEXT.md.
'use strict';

/**
 * @typedef {'movie' | 'show'} Kind
 * @typedef {{ sampleMovieMinutes: number, sampleShowMinutes: number, minimumAudience: number,
 *   downvoteShare: number, baseWeightDays: number, titleBonus: number }} Settings
 * @typedef {{ seconds: number, watched: boolean }} Play
 * @typedef {{ id: string, baseWeight: number, sampled: boolean }} Voter
 */

/** @type {Settings} */
const DEFAULTS = {
  sampleMovieMinutes: 30,
  sampleShowMinutes: 10,
  minimumAudience: 3,
  downvoteShare: 0.5,
  baseWeightDays: 90,
  titleBonus: 2,
};

// A Sample: play time on the Title adds up to the Sample length for its kind, or any play is a Watch.
/** @param {Kind} kind @param {Play[]} plays @param {Settings} s */
function hasSampled(kind, plays, s) {
  if (plays.some(p => p.watched)) return true;
  const minutes = kind === 'movie' ? s.sampleMovieMinutes : s.sampleShowMinutes;
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

module.exports = { DEFAULTS, hasSampled, baseWeights, voteWeight, checkThreshold };
