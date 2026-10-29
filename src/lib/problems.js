// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Problem Reports: a Voter says a copy of a Title is broken or poor quality, on the whole Title or, for a
// show, one season or episode. A second Voter with the same problem joins the open report ("me too").
// The Owner resolves or closes it, with an optional note, and everyone on it sees which. A Problem Report
// never counts as a Downvote: nothing here touches Downvotes or the Review Queue.
'use strict';

/** @typedef {import('./store').Store} Store */

// The reasons a Voter picks from. Other needs a note.
const REASONS = /** @type {const} */ ({
  'wont-play': "Won't play",
  video: 'Video',
  audio: 'Audio',
  subtitles: 'Subtitles',
  wrong: 'Wrong title or language',
  quality: 'Poor quality',
  other: 'Other',
});
const NOTE_MAX = 500;
// How long a resolved or closed report stays on the Voter's list.
const SHOW_DECIDED_DAYS = 30;

/** @param {unknown} v @returns {string | null} */
const noteOf = v =>
  String(v ?? '')
    .trim()
    .slice(0, NOTE_MAX) || null;
/** @param {unknown} v @returns {number | null | undefined} undefined when it isn't a whole number */
const wholeOrNull = v =>
  v == null || v === '' ? null : Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;

// Which part of a Title a report is about, in words.
/** @param {{ season: number | null, episode: number | null, episode_title: string | null }} p */
function partOf(p) {
  if (p.season == null) return null;
  const season = p.season === 0 ? 'Specials' : `Season ${p.season}`;
  if (p.episode == null) return season;
  const code = `${p.season === 0 ? 'Special' : `S${p.season}`} E${p.episode}`;
  return p.episode_title ? `${code} · ${p.episode_title}` : code;
}

/**
 * File a Problem Report, or join the open one with the same part and reason.
 * @param {Store} store @param {string} voterId
 * @param {{ titleKey: string, season?: unknown, episode?: unknown, reason?: unknown, note?: unknown }} input
 * @param {number} now
 * @param {(showKey: string) => Promise<Array<{ season: number, episode: number, title: string }>>} episodes
 *   a show's episodes from Plex, to check the part exists and name the episode
 * @returns {Promise<{ ok: true, id: number, joined: boolean } | { ok: false, error: string }>}
 */
async function report(store, voterId, input, now, episodes) {
  const t = store.title(input.titleKey);
  if (!t) return { ok: false, error: 'unknown-title' };
  const reason = String(input.reason ?? '');
  if (!Object.hasOwn(REASONS, reason)) return { ok: false, error: 'pick-a-reason' };
  const note = noteOf(input.note);
  if (reason === 'other' && !note) return { ok: false, error: 'say-what' };
  const season = wholeOrNull(input.season);
  const episode = wholeOrNull(input.episode);
  if (season === undefined || episode === undefined || (episode != null && season == null))
    return { ok: false, error: 'unknown-part' };
  let episodeTitle = null;
  if (season != null) {
    if (t.kind !== 'show') return { ok: false, error: 'unknown-part' };
    const list = await episodes(t.rating_key);
    const found = list.filter(e => e.season === season && (episode == null || e.episode === episode));
    if (!found.length) return { ok: false, error: 'unknown-part' };
    if (episode != null) episodeTitle = found[0].title || null;
  }
  const same = store.sameProblem(t.rating_key, season, episode, reason);
  if (same) {
    if (!store.addReporter(same.id, voterId, note, now)) return { ok: false, error: 'already-reported' };
    return { ok: true, id: same.id, joined: true };
  }
  let id = 0;
  store.tx(() => {
    id = store.addProblem({ titleKey: t.rating_key, season, episode, episodeTitle, reason }, now);
    store.addReporter(id, voterId, note, now);
  });
  return { ok: true, id, joined: false };
}

// "Me too" on an open report the Voter saw on the Title.
/** @param {Store} store @param {string} voterId @param {number} id @param {unknown} note @param {number} now */
function meToo(store, voterId, id, note, now) {
  const p = store.problem(id);
  if (!p || p.outcome) return { ok: false, error: 'not-open' };
  if (!store.addReporter(id, voterId, noteOf(note), now)) return { ok: false, error: 'already-reported' };
  return { ok: true };
}

// Taken back while it's open. A report nobody is on any more is gone.
/** @param {Store} store @param {string} voterId @param {number} id */
function withdrawReport(store, voterId, id) {
  const p = store.problem(id);
  if (!p || p.outcome) return { ok: false, error: 'not-open' };
  if (!store.removeReporter(id, voterId)) return { ok: false, error: 'not-reported' };
  return { ok: true };
}

/** @param {Store} store @param {number} id @param {'resolved' | 'closed'} outcome @param {unknown} note @param {number} now */
function decide(store, id, outcome, note, now) {
  return store.decideProblem(id, outcome, noteOf(note), now) ? { ok: true } : { ok: false, error: 'not-open' };
}

/** @param {Store} store @param {import('./store').ProblemRow} p */
function titleOf(store, p) {
  const t = store.title(p.title_key);
  return {
    ratingKey: p.title_key,
    kind: t?.kind,
    name: t?.title,
    year: t?.year ?? null,
    library: t?.library ?? null,
    // Relative to Media Review's address, with the API key (as on the Review Queue).
    poster: t?.thumb ? `/api/v1/poster/${encodeURIComponent(p.title_key)}` : null,
  };
}

/** @param {import('./store').ProblemRow} p */
const describe = p => ({
  id: p.id,
  part: partOf(p),
  season: p.season,
  episode: p.episode,
  reason: p.reason,
  reasonLabel: REASONS[/** @type {keyof typeof REASONS} */ (p.reason)] ?? p.reason,
  reportedAt: iso(p.created_at),
});

// The open reports, oldest first, for the Owner and Media Ops: who has the problem and what each said.
/** @param {Store} store */
function openReports(store) {
  return store.openProblems().map(p => ({
    ...describe(p),
    title: titleOf(store, p),
    reporters: store.reportersOf(p.id).map(r => ({
      voter: r.username ?? r.voter_id,
      note: r.note,
      at: iso(r.created_at),
    })),
  }));
}

// A Voter's own reports, and what happened to them. Never who else is on one.
/** @param {Store} store @param {string} voterId @param {number} now */
function reportsBy(store, voterId, now) {
  return store.problemsBy(voterId, now - SHOW_DECIDED_DAYS * 86400).map(p => ({
    ...describe(p),
    title: { ...titleOf(store, p), poster: undefined },
    note: p.note,
    outcome: p.outcome,
    ownerNote: p.owner_note,
    decidedAt: p.decided_at == null ? null : iso(p.decided_at),
  }));
}

// The open reports on one Title, so a Voter can say "me too" instead of filing it again. No names.
/** @param {Store} store @param {string} voterId @param {string} titleKey */
function openOn(store, voterId, titleKey) {
  return store.openProblemsOf(titleKey).map(p => ({
    ...describe(p),
    mine: store.reportersOf(p.id).some(r => r.voter_id === voterId),
  }));
}

/** @param {number} t unix seconds */
const iso = t => new Date(t * 1000).toISOString();

module.exports = { REASONS, report, meToo, withdrawReport, decide, openReports, reportsBy, openOn, partOf };
