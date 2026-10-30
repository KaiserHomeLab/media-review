// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// One Title's whole story, for the Owner's history search on the Review Queue page: where it stands now, then
// everything that happened to it, newest first (Downvotes, the Review Queue, Keep and Remove with who Downvoted
// and objected each time, Leaving Soon, deletion, Problem Reports, asks to bring it back), and who has played it.
'use strict';
const problems = require('./problems');

/** @param {number} t */
const iso = t => new Date(t * 1000).toISOString();
/** @param {number} n */
const round = n => Math.round(n * 100) / 100;
/** @param {{ username?: string | null, voter_id: string }} r */
const who = r => r.username ?? r.voter_id;

/**
 * @typedef {{ at: string, kind: string, text: string, people?: string[], note?: string | null }} Event
 */

/**
 * @param {import('./store').Store} store @param {string} titleKey
 * @param {{ posterUrl?: (key: string) => string }} [opts]
 */
function titleHistory(store, titleKey, opts = {}) {
  const t = store.title(titleKey);
  if (!t) return null;
  const h = store.historyOf(titleKey);
  /** @type {Array<Event & { t: number }>} */
  const events = [];
  /** @param {number} at @param {string} kind @param {string} text @param {Partial<Event>} [more] */
  const add = (at, kind, text, more = {}) => events.push({ t: at, at: iso(at), kind, text, ...more });

  for (const d of h.downvotes) add(d.created_at, 'downvote', `Downvoted by ${who(d)}`);
  for (const o of h.objections) add(o.created_at, 'objection', `Objection from ${who(o)}`);
  for (const q of h.queue)
    add(
      q.queued_at,
      'queue',
      q.sent_back
        ? 'Sent back to the Review Queue by Objections'
        : `Reached the Review Queue: ${round(q.downvote_weight)} of ${round(q.audience_weight)} weight from an Audience of ${q.audience}`,
    );

  // Each Keep, Remove and deletion, with who Downvoted (as weighed) and objected at that moment.
  const votes = store.votesOf(titleKey);
  /** @param {number} at */
  const peopleAt = at => {
    /** @param {'downvote' | 'objection'} kind */
    const names = kind =>
      votes
        .filter(v => v.at === at && v.kind === kind)
        .map(v => (v.vote_weight == null ? who(v) : `${who(v)} (${round(v.vote_weight)})`));
    const down = names('downvote');
    const obj = names('objection');
    return [
      ...(down.length ? [`Downvoted by ${down.join(', ')}`] : []),
      ...(obj.length ? [`Objections from ${obj.join(', ')}`] : []),
    ];
  };
  for (const d of store.decisionsOf(titleKey))
    add(d.at, d.decision, d.decision === 'keep' ? 'Kept' : 'Removed: Leaving Soon', { people: peopleAt(d.at) });
  for (const l of h.leaving)
    if (l.delete_error) add(l.ends_at, 'failed', `Couldn't delete it: ${l.delete_error}. Tried again each night.`);
  for (const d of store.deletionsOf(titleKey))
    add(d.at, 'deleted', `Deleted from ${d.deleted_from.split(',').join(' and ')}`, { people: peopleAt(d.at) });
  for (const b of h.broughtBack) add(b.at, 'back', 'Brought back');

  for (const p of h.problems) {
    const part = problems.partOf(p);
    const what = `${problems.REASONS[/** @type {keyof typeof problems.REASONS} */ (p.reason)] ?? p.reason}${part ? `, ${part}` : ''}`;
    const reporters = store.reportersOf(p.id);
    add(p.created_at, 'problem', `Problem Report: ${what}`, {
      people: reporters.map(r => `${who(r)}${r.note ? `: “${r.note}”` : ''}`),
    });
    if (p.outcome && p.decided_at != null)
      add(p.decided_at, 'problem-done', `Problem Report ${p.outcome === 'resolved' ? 'resolved' : 'closed'}: ${what}`, {
        note: p.owner_note,
      });
  }
  for (const a of h.asks) {
    add(a.created_at, 'ask', `${who(a)} asked to bring it back`, { note: a.note });
    if (a.outcome && a.decided_at != null)
      add(a.decided_at, 'ask-done', `${a.outcome === 'brought-back' ? 'Brought back' : 'Declined'} for ${who(a)}`, {
        note: a.owner_note,
      });
  }

  // Where it stands now.
  const leaving = h.leaving[0];
  const now = h.queue.length
    ? 'In the Review Queue'
    : leaving
      ? `Leaving Soon until ${iso(leaving.ends_at).slice(0, 10)}`
      : h.heldBack.length
        ? `Deleted ${iso(h.heldBack[0].since).slice(0, 10)}, held back${h.heldBack[0].blocked ? ' in Seerr' : ''}`
        : t.seen
          ? h.downvotes.length
            ? `In the library, ${h.downvotes.length} Downvote${h.downvotes.length === 1 ? '' : 's'} so far`
            : 'In the library'
          : 'No longer in Plex';

  // Who has played it: each friend once, with their latest play and whether they ever watched it to the end.
  /** @type {Map<string, { voter: string, last: string, minutes: number, finished: boolean, plays: number }>} */
  const viewers = new Map();
  for (const p of h.plays) {
    const v = viewers.get(p.voter_id) ?? { voter: who(p), last: iso(p.started), minutes: 0, finished: false, plays: 0 };
    v.minutes += p.seconds / 60;
    v.finished ||= !!p.watched;
    v.plays++;
    viewers.set(p.voter_id, v);
  }

  return {
    title: {
      ratingKey: titleKey,
      name: t.title,
      year: t.year ?? null,
      kind: t.kind,
      library: t.library ?? null,
      inPlex: !!t.seen,
      poster: t.thumb && opts.posterUrl ? opts.posterUrl(titleKey) : null,
    },
    now,
    events: events.sort((a, b) => b.t - a.t).map(({ t: _, ...e }) => e),
    viewers: [...viewers.values()].map(v => ({ ...v, minutes: Math.round(v.minutes) })),
  };
}

module.exports = { titleHistory };
