// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Discord, with no library: its REST API for replies and setup, and the gateway (a WebSocket Media Review keeps
// open, so no public address is needed) for slash commands. Uses API v10 and Node's built-in WebSocket.
'use strict';

const API = 'https://discord.com/api/v10';
// The gateway closes with these when retrying can't help: bad token, bad intents, and so on.
const FATAL = new Map([
  [4004, 'Discord refused the bot token'],
  [4010, 'Discord says the shard is invalid'],
  [4011, 'Discord says the bot needs sharding'],
  [4012, 'Discord refused the gateway version'],
  [4013, 'Discord refused the intents'],
  [4014, 'Discord refused the intents (they need turning on in the Developer Portal)'],
]);
const EPHEMERAL = 64; // only the person who used the command sees the reply

/** @typedef {typeof fetch} Fetch */

/** @param {{ token: string, fetch?: Fetch, api?: string, sleep?: (ms: number) => Promise<void> }} cfg */
function rest(cfg) {
  const sleep = cfg.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  const f = cfg.fetch ?? fetch;
  const base = cfg.api ?? API;
  // Discord says how long to wait when it rate limits (retry_after, seconds): wait that long and try again,
  // twice at most, when it's short; say how long when it isn't.
  /** @param {string} method @param {string} path @param {unknown} [body] @param {number} [tries] @returns {Promise<any>} */
  const call = async (method, path, body, tries = 0) => {
    let res;
    try {
      res = await f(base + path, {
        method,
        headers: {
          Authorization: `Bot ${cfg.token}`,
          'User-Agent': 'MediaReview (https://github.com/KaiserHomeLab/media-review, 1)',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new Error(`couldn't reach Discord (${e?.cause?.message ?? e.message})`, { cause: e });
    }
    if (res.status === 401) throw new Error('Discord refused the bot token');
    if (res.status === 429) {
      const info = await res.json().catch(() => null);
      const wait = Number(info?.retry_after ?? res.headers.get('retry-after') ?? 1);
      if (wait <= 10 && tries < 2) {
        await sleep(Math.ceil(wait * 1000) + 100);
        return call(method, path, body, tries + 1);
      }
      throw new Error(`Discord is rate limiting Media Review: try again in ${Math.ceil(wait)} seconds`);
    }
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(`Discord answered HTTP ${res.status}${detail?.message ? `: ${detail.message}` : ''}`);
    }
    return res.status === 204 ? null : res.json();
  };
  return {
    call,
    /** @returns {Promise<{ id: string, username: string }>} */
    me: () => call('GET', '/users/@me'),
    /** @returns {Promise<Array<{ id: string, name: string }>>} the servers the bot is in */
    guilds: () => call('GET', '/users/@me/guilds'),
    /** @returns {Promise<{ url: string }>} */
    gateway: () => call('GET', '/gateway/bot'),
    /** @param {string} appId @param {string} guildId @param {unknown[]} commands */
    setCommands: (appId, guildId, commands) =>
      call('PUT', `/applications/${appId}/guilds/${guildId}/commands`, commands),
    // Answer a command or autocomplete. Discord gives 3 seconds for this.
    /** @param {string} id @param {string} token @param {unknown} response */
    respond: (id, token, response) => call('POST', `/interactions/${id}/${token}/callback`, response),
    // Replace a deferred ("thinking…") reply with the real one.
    /** @param {string} appId @param {string} token @param {string} content */
    editReply: (appId, token, content) =>
      call('PATCH', `/webhooks/${appId}/${token}/messages/@original`, { content, allowed_mentions: { parse: [] } }),
  };
}
/** @typedef {ReturnType<typeof rest>} Rest */

/**
 * Keep a gateway connection open: hello, identify, heartbeat; resume after a drop, start over when Discord
 * says so, and stop for good on a fatal close (a bad token). Calls onInteraction for each slash command and
 * autocomplete in any server the bot is in.
 * @param {{ token: string, rest: Rest, log: (msg: string) => void,
 *   onReady: (ready: { applicationId: string, username: string }) => void | Promise<void>,
 *   onInteraction: (interaction: any) => void | Promise<void>,
 *   onStatus?: (status: { connected: boolean, error: string | null }) => void,
 *   WebSocket?: typeof WebSocket, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} cfg
 */
function gateway(cfg) {
  const WS = cfg.WebSocket ?? WebSocket;
  const setT = cfg.setTimer ?? setTimeout;
  const clearT = cfg.clearTimer ?? clearTimeout;
  const status = cfg.onStatus ?? (() => {});
  /** @type {WebSocket | null} */
  let ws = null;
  /** @type {any} */
  let beat = null;
  /** @type {any} */
  let retry = null;
  let seq = /** @type {number | null} */ (null);
  let session = /** @type {{ id: string, url: string } | null} */ (null);
  let acked = true;
  let stopped = false;
  let tries = 0;

  /** @param {number} op @param {unknown} d */
  const send = (op, d) => ws?.readyState === 1 && ws.send(JSON.stringify({ op, d }));
  const identify = () =>
    send(2, {
      token: cfg.token,
      intents: 0,
      properties: { os: 'linux', browser: 'media-review', device: 'media-review' },
    });

  /** @param {number} ms */
  const later = ms => {
    clearT(retry);
    retry = setT(() => void connect().catch(e => drop(e.message)), ms);
  };
  // Lost it: try again, sooner at first, then every minute at most.
  /** @param {string} why */
  const drop = why => {
    clearInterval(beat);
    ws = null;
    if (stopped) return;
    status({ connected: false, error: why });
    later(Math.min(60000, 1000 * 2 ** Math.min(tries++, 6)));
  };

  async function connect() {
    if (stopped) return;
    const url = session?.url ?? (await cfg.rest.gateway()).url;
    const sock = new WS(`${url}/?v=10&encoding=json`);
    ws = sock;
    sock.addEventListener('message', ev => {
      if (ws !== sock) return;
      const msg = JSON.parse(String(ev.data));
      if (msg.s != null) seq = msg.s;
      if (msg.op === 10) {
        // Hello: beat at Discord's interval, the first one after a random part of it, as Discord asks.
        const every = Number(msg.d.heartbeat_interval);
        acked = true;
        const tick = () => {
          if (!acked) return sock.close(4000, 'no heartbeat ack'); // a zombie connection: start again
          acked = false;
          send(1, seq);
        };
        clearInterval(beat);
        setT(
          () => {
            if (ws !== sock) return;
            tick();
            beat = setInterval(tick, every);
          },
          Math.floor(every * Math.random()),
        );
        if (session) send(6, { token: cfg.token, session_id: session.id, seq });
        else identify();
      } else if (msg.op === 11) acked = true;
      else if (msg.op === 1) send(1, seq);
      else if (msg.op === 7)
        sock.close(4000, 'reconnect asked'); // resume on the new connection
      else if (msg.op === 9) {
        // Invalid session: resume if Discord says it can, else identify again after a moment.
        if (!msg.d) session = null;
        setT(() => (session ? send(6, { token: cfg.token, session_id: session.id, seq }) : identify()), 2000);
      } else if (msg.op === 0) {
        if (msg.t === 'READY') {
          session = { id: msg.d.session_id, url: msg.d.resume_gateway_url };
          tries = 0;
          status({ connected: true, error: null });
          Promise.resolve(cfg.onReady({ applicationId: msg.d.application.id, username: msg.d.user.username })).catch(
            e => cfg.log(`Discord: setting up the commands failed: ${e.message}`),
          );
        } else if (msg.t === 'RESUMED') {
          tries = 0;
          status({ connected: true, error: null });
        } else if (msg.t === 'INTERACTION_CREATE')
          Promise.resolve(cfg.onInteraction(msg.d)).catch(e => cfg.log(`Discord: a command failed: ${e.message}`));
      }
    });
    sock.addEventListener('close', ev => {
      if (ws !== sock) return;
      const fatal = FATAL.get(ev.code);
      if (fatal) {
        clearInterval(beat);
        ws = null;
        stopped = true;
        cfg.log(`Discord: ${fatal}. The bot is off until Settings are fixed.`);
        return status({ connected: false, error: fatal });
      }
      if (ev.code === 4007 || ev.code === 4009) session = null; // can't resume: identify fresh
      drop(`the connection to Discord closed (${ev.code})`);
    });
    sock.addEventListener('error', () => {}); // a close always follows
  }

  return {
    start: () => void connect().catch(e => drop(e.message)),
    stop: () => {
      stopped = true;
      clearInterval(beat);
      clearT(retry);
      const sock = ws;
      ws = null;
      sock?.close(1000, 'stopping');
    },
  };
}

module.exports = { rest, gateway, EPHEMERAL };
