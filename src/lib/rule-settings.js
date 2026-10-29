// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// The rules as the Owner set them on the Settings page, over the defaults. `values` is live: every
// read sees what was last saved, so a change applies without a restart. Each value is checked; one
// that makes no sense is refused with a reason, and nothing is saved.
'use strict';
const { DEFAULTS } = require('./rules');

/** @typedef {import('./rules').Settings} Settings */

// What each rule may be: a whole number (int) or not, and its range.
/** @type {Record<Exclude<keyof Settings, 'animeLibraries'>, { min: number, max: number, int: boolean, what: string }>} */
const LIMITS = {
  sampleMovieMinutes: { min: 1, max: 240, int: true, what: 'minutes' },
  sampleShowMinutes: { min: 1, max: 240, int: true, what: 'minutes' },
  sampleAnimeMinutes: { min: 1, max: 240, int: true, what: 'minutes' },
  minimumAudience: { min: 1, max: 100, int: true, what: 'Voters' },
  downvoteShare: { min: 0.01, max: 1, int: false, what: 'of the Audience' },
  baseWeightDays: { min: 7, max: 365, int: true, what: 'days' },
  titleBonus: { min: 0, max: 10, int: false, what: '' },
  leavingSoonDays: { min: 1, max: 90, int: true, what: 'days' },
  deleteHour: { min: 0, max: 23, int: true, what: "o'clock" },
};

const KEY = 'rules';

/** @param {import('./store').Store} store */
function ruleSettings(store) {
  /** @returns {Partial<Settings>} */
  const saved = () => {
    try {
      return JSON.parse(store.getSetting(KEY) ?? '{}');
    } catch {
      return {};
    }
  };
  let current = { ...DEFAULTS, ...saved() };
  // Live: properties read the latest saved rules each time.
  const values = /** @type {Settings} */ ({});
  for (const k of /** @type {Array<keyof Settings>} */ (Object.keys(DEFAULTS)))
    Object.defineProperty(values, k, { enumerable: true, get: () => current[k] });

  return {
    values,
    // Check every value given, then save them all, or none.
    /** @param {Record<string, unknown>} input @returns {{ ok: true } | { ok: false, errors: Record<string, string> }} */
    save(input) {
      /** @type {Record<string, string>} */
      const errors = {};
      /** @type {Partial<Settings>} */
      const next = {};
      for (const [k, v] of Object.entries(input)) {
        if (k === 'animeLibraries') {
          if (Array.isArray(v) && v.every(x => typeof x === 'string' && /^\w{1,32}$/.test(x)))
            next.animeLibraries = [...new Set(/** @type {string[]} */ (v))];
          else errors[k] = 'pick libraries from the list';
          continue;
        }
        if (!Object.hasOwn(LIMITS, k)) {
          errors[k] = 'not a setting';
          continue;
        }
        const lim = LIMITS[/** @type {keyof typeof LIMITS} */ (k)];
        const n = typeof v === 'number' ? v : NaN;
        if (!Number.isFinite(n) || (lim.int && !Number.isInteger(n)))
          errors[k] = lim.int ? 'a whole number' : 'a number';
        else if (n < lim.min || n > lim.max)
          errors[k] =
            k === 'downvoteShare'
              ? `between ${lim.min * 100}% and ${lim.max * 100}%`
              : `at least ${lim.min} and at most ${lim.max}${lim.what ? ` ${lim.what}` : ''}`;
        else next[/** @type {keyof typeof LIMITS} */ (k)] = n;
      }
      if (Object.keys(errors).length) return { ok: false, errors };
      store.setSetting(KEY, JSON.stringify({ ...saved(), ...next }));
      current = { ...DEFAULTS, ...saved() };
      return { ok: true };
    },
  };
}

// The page shows the share as a percentage; everything else as it is.
/** @param {Settings} s */
const toForm = s => {
  const { downvoteShare, ...rest } = s;
  return { ...rest, downvoteSharePercent: Math.round(downvoteShare * 1000) / 10 };
};

// What the page sends back: numbers typed as text, the share as a percentage.
/** @param {Record<string, unknown>} form @returns {Record<string, unknown>} */
function fromForm(form) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(form)) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (k === 'downvoteSharePercent') out.downvoteShare = typeof n === 'number' ? Math.round(n * 10) / 1000 : n;
    else out[k] = n;
  }
  return out;
}

module.exports = { ruleSettings, toForm, fromForm, LIMITS };
