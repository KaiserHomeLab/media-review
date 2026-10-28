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
  const timeoutMs = opts.timeoutMs ?? 15000;
  let res;
  try {
    res = await f(url, {
      method: opts.method ?? 'GET',
      headers: { Accept: 'application/json', ...opts.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Error(unreachable(app, e, timeoutMs), { cause: e });
  }
  if (!res.ok) throw new Error(`${app} answered HTTP ${res.status}`);
  return res.json();
}

// Why an app couldn't be reached, in words the Owner can act on (fetch itself just says "fetch failed").
/** @param {string} app @param {any} e @param {number} timeoutMs */
function unreachable(app, e, timeoutMs) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError')
    return `${app} didn't answer within ${timeoutMs / 1000} seconds`;
  const code = e?.cause?.code ?? e?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
    return `no such address: is ${app} on the same Docker network, with that name?`;
  if (code === 'ECONNREFUSED') return `nothing is answering at that address and port, so ${app} isn't there`;
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return `that address can't be reached from Media Review`;
  if (String(code ?? '').includes('CERT') || /certificate/i.test(e?.cause?.message ?? ''))
    return `${app}'s https certificate isn't trusted: try its http:// address on your network`;
  return `couldn't reach ${app} (${e?.cause?.message ?? e?.message ?? 'no answer'})`;
}

/** @param {string} base @param {string} path */
const join = (base, path) => base.replace(/\/+$/, '') + path;

module.exports = { fetchJson, join };
