// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';

/** @typedef {typeof fetch} Fetch */

// JSON request with a timeout. Errors name the app but never the URL, which can carry a key or token.
/**
 * @param {Fetch} f @param {string} app @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, timeoutMs?: number }} [opts]
 * @returns {Promise<any>}
 */
async function fetchJson(f, app, url, opts = {}) {
  const res = await f(url, {
    method: opts.method ?? 'GET',
    headers: { Accept: 'application/json', ...opts.headers },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
  });
  if (!res.ok) throw new Error(`${app} answered HTTP ${res.status}`);
  return res.json();
}

/** @param {string} base @param {string} path */
const join = (base, path) => base.replace(/\/+$/, '') + path;

module.exports = { fetchJson, join };
