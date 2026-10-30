// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Settings → Diagnostics, as in Media Ops: check every app live, say exactly what each answered, and make a
// short report to paste into a GitHub issue. The report has no keys or tokens (Media Review never has them
// in a message), and no IP addresses or people's names.
'use strict';
const os = require('node:os');
const { fetchJson, join } = require('./http');
const { APPS, probe: probeApp } = require('./apps');
const { rest: discordRest } = require('./discord');
const VERSION = require('../package.json').version;

/**
 * @typedef {{ name: string, ok: boolean, detail: string, ms: number }} Check
 * @param {{ apps: import('./apps').AppSettings, plex: ReturnType<typeof import('./plex').plex>,
 *   probe?: typeof probeApp, fetch?: typeof fetch }} deps
 * @returns {Promise<Check[]>}
 */
async function runChecks({ apps, plex, probe = probeApp, fetch: f = fetch }) {
  const all = apps.read();
  /** @param {string} name @param {() => Promise<string>} fn @returns {Promise<Check>} */
  const check = async (name, fn) => {
    const t0 = performance.now();
    try {
      const detail = await fn();
      return { name, ok: true, detail, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      return { name, ok: false, detail: e.message, ms: Math.round(performance.now() - t0) };
    }
  };
  const checks = [];
  const p = all.plex;
  if (!p) return [{ name: 'Plex', ok: false, detail: 'not linked yet: do first setup', ms: 0 }];
  checks.push(
    check('Plex', async () => {
      const id = await fetchJson(f, 'Plex', join(p.url, '/identity'), { headers: { 'X-Plex-Token': p.token } });
      if (id?.MediaContainer?.machineIdentifier !== p.machineId)
        throw new Error('that address is a different Plex server');
      return `${p.name}, version ${id.MediaContainer.version ?? '?'}`;
    }),
    check('plex.tv (who has access)', async () => {
      const ids = await plex.sharedWith(p.machineId);
      return `shared with ${ids.size} account${ids.size === 1 ? '' : 's'}`;
    }),
  );
  for (const id of /** @type {import('./apps').AppId[]} */ (Object.keys(APPS))) {
    const cfg = all[id];
    if (cfg) checks.push(check(APPS[id].label, async () => `version ${(await probe(id, cfg, f)) || '?'}`));
  }
  const d = all.discord;
  if (d)
    checks.push(
      check('Discord', async () => {
        const api = discordRest({ token: d.token, fetch: f });
        const me = await api.me();
        // The bot can see each channel it posts to (it can't post where it can't see).
        for (const [what, id] of /** @type {const} */ ([
          ['announcements', d.announceChannel],
          ['your channel', d.ownerChannel],
        ]))
          if (id)
            await api.call('GET', `/channels/${id}`).catch(e => {
              throw new Error(`the bot can't see ${what} (${e.message})`, { cause: e });
            });
        return `@${me.username} in ${d.guildName}`;
      }),
    );
  if (all.publicUrl)
    checks.push(
      check('Public address', async () => {
        const res = await f(join(all.publicUrl ?? '', '/healthz'), { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`answered HTTP ${res.status}: is the tunnel pointing at Media Review?`);
        return 'reachable from Media Review';
      }),
    );
  return Promise.all(checks);
}

// IP addresses out of anything that goes in the report.
/** @param {string} s */
const redact = s =>
  String(s)
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '•.•.•.•')
    .replace(/\b[0-9a-f]*:[0-9a-f]*:[0-9a-f:]*\b/gi, '•:•:•') // IPv6, shortened (fe80::1) or not
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '•@•');

/**
 * The short report: version, the jobs' last results and the checks, without names or addresses.
 * @param {Record<string, any>} status @param {Check[]} checks @param {number} now unix seconds
 */
function report(status, checks, now) {
  /** @param {number | undefined} at */
  const ago = at => {
    if (!at) return 'never';
    const m = Math.round((now - at) / 60);
    return m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };
  const lines = [
    `Media Review ${VERSION} · Node ${process.version} · ${os.platform()} · TZ ${process.env.TZ || 'unset'}`,
    '',
    'Jobs:',
  ];
  for (const [name, s] of Object.entries(status)) {
    let extra = '';
    if (name === 'sync' && Array.isArray(s.steps))
      extra = ` (${s.steps.map((/** @type {any} */ x) => `${x.name} ${x.ok ? (x.count ?? 'ok') : 'failed'}`).join(', ')})`;
    if (name === 'access') extra = ` (${s.removed?.length ?? 0} signed out, ${s.restored?.length ?? 0} back)`;
    if (name === 'deletions')
      extra = s.ran ? ` (deleted ${s.deleted?.length ?? 0})` : ' (outside the overnight window)';
    lines.push(`- ${name}: ${s.ok ? 'ok' : `FAILED: ${s.error}`}, ${ago(s.at)}${extra}`);
  }
  lines.push('', 'Checks:');
  for (const c of checks) lines.push(`- ${c.name}: ${c.ok ? 'ok' : 'FAILED'}, ${c.ms} ms: ${c.detail}`);
  return redact(lines.join('\n'));
}

module.exports = { runChecks, report, redact };
