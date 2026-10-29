// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gateway, rest } = require('../lib/discord');

// A stand-in for the gateway's WebSocket: records what the client sends; the test plays Discord.
function fakeSockets() {
  const all = /** @type {any[]} */ ([]);
  class FakeWS {
    /** @param {string} url */
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.sent = /** @type {any[]} */ ([]);
      /** @type {Record<string, Function[]>} */
      this.on = {};
      all.push(this);
    }
    /** @param {string} type @param {Function} fn */
    addEventListener(type, fn) {
      (this.on[type] ??= []).push(fn);
    }
    /** @param {string} data */
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    /** @param {number} code */
    close(code = 1000) {
      this.readyState = 3;
      for (const fn of this.on.close ?? []) fn({ code });
    }
    /** @param {any} msg */
    receive(msg) {
      for (const fn of this.on.message ?? []) fn({ data: JSON.stringify(msg) });
    }
  }
  return { all, WebSocket: /** @type {any} */ (FakeWS) };
}

/** Timers that run only when the test says so. */
function fakeTimers() {
  const due = /** @type {Array<() => void>} */ ([]);
  return {
    setTimer: /** @type {any} */ ((/** @type {() => void} */ fn) => (due.push(fn), due.length)),
    clearTimer: () => {},
    runAll: () => {
      while (due.length) /** @type {() => void} */ (due.shift())();
    },
  };
}

function setup() {
  const s = fakeSockets();
  const t = fakeTimers();
  const events = /** @type {any[]} */ ([]);
  const statuses = /** @type {any[]} */ ([]);
  const logs = /** @type {string[]} */ ([]);
  const g = gateway({
    token: 'bot-token',
    rest: /** @type {any} */ ({ gateway: async () => ({ url: 'wss://gateway.discord.gg' }) }),
    log: m => logs.push(m),
    onReady: r => void events.push(['ready', r]),
    onInteraction: i => void events.push(['interaction', i.id]),
    onStatus: st => void statuses.push(st),
    WebSocket: s.WebSocket,
    setTimer: t.setTimer,
    clearTimer: t.clearTimer,
  });
  return { g, s, t, events, statuses, logs };
}
const flush = () => new Promise(r => setImmediate(r));
const READY = {
  op: 0,
  s: 1,
  t: 'READY',
  d: {
    session_id: 'sess',
    resume_gateway_url: 'wss://resume.discord.gg',
    application: { id: 'app1' },
    user: { username: 'Media Review' },
  },
};

test('connects, identifies after hello, beats its heart, and hands on READY and commands', async t => {
  const x = setup();
  t.after(() => x.g.stop());
  x.g.start();
  await flush();
  const ws = x.s.all[0];
  assert.equal(ws.url, 'wss://gateway.discord.gg/?v=10&encoding=json');
  ws.receive({ op: 10, d: { heartbeat_interval: 41250 } });
  assert.equal(ws.sent[0].op, 2);
  assert.equal(ws.sent[0].d.token, 'bot-token');
  assert.equal(ws.sent[0].d.intents, 0, 'no intents: slash commands need none');
  x.t.runAll(); // the first heartbeat
  assert.deepEqual(ws.sent[1], { op: 1, d: null });
  ws.receive(READY);
  ws.receive({ op: 0, s: 2, t: 'INTERACTION_CREATE', d: { id: 'int-1' } });
  await flush();
  assert.deepEqual(x.events, [
    ['ready', { applicationId: 'app1', username: 'Media Review' }],
    ['interaction', 'int-1'],
  ]);
  assert.deepEqual(x.statuses.at(-1), { connected: true, error: null });
});

test('a dropped connection resumes the session at the resume address, with the last sequence', async t => {
  const x = setup();
  t.after(() => x.g.stop());
  x.g.start();
  await flush();
  x.s.all[0].receive({ op: 10, d: { heartbeat_interval: 1000 } });
  x.s.all[0].receive(READY);
  x.s.all[0].receive({ op: 0, s: 7, t: 'INTERACTION_CREATE', d: { id: 'x' } });
  x.s.all[0].close(1006);
  assert.equal(x.statuses.at(-1).connected, false);
  x.t.runAll();
  await flush();
  const again = x.s.all[1];
  assert.equal(again.url, 'wss://resume.discord.gg/?v=10&encoding=json');
  again.receive({ op: 10, d: { heartbeat_interval: 1000 } });
  assert.deepEqual(again.sent[0], { op: 6, d: { token: 'bot-token', session_id: 'sess', seq: 7 } });
});

test('a bad token stops for good, and says so', async t => {
  const x = setup();
  t.after(() => x.g.stop());
  x.g.start();
  await flush();
  x.s.all[0].close(4004);
  x.t.runAll();
  await flush();
  assert.equal(x.s.all.length, 1, 'no retry');
  assert.deepEqual(x.statuses.at(-1), { connected: false, error: 'Discord refused the bot token' });
  assert.match(x.logs[0], /refused the bot token/);
});

test('no heartbeat ack: the connection is a zombie, so it is closed and made again', async t => {
  const x = setup();
  t.after(() => x.g.stop());
  x.g.start();
  await flush();
  const ws = x.s.all[0];
  ws.receive({ op: 10, d: { heartbeat_interval: 30 } });
  x.t.runAll(); // first beat, never acked
  await new Promise(r => setTimeout(r, 50)); // the next beat finds no ack
  assert.equal(ws.readyState, 3);
});

test('REST: the bot token goes in the header, and a refused token is said plainly', async () => {
  const seen = /** @type {any[]} */ ([]);
  const api = rest({
    token: 'tkn',
    fetch: /** @type {any} */ (
      async (/** @type {string} */ url, /** @type {any} */ init) => {
        seen.push([init.method, url, init.headers.Authorization]);
        return url.endsWith('/users/@me')
          ? Response.json({ id: '1', username: 'bot' })
          : new Response('', { status: 401 });
      }
    ),
  });
  assert.deepEqual(await api.me(), { id: '1', username: 'bot' });
  assert.deepEqual(seen[0], ['GET', 'https://discord.com/api/v10/users/@me', 'Bot tkn']);
  await assert.rejects(api.guilds(), /Discord refused the bot token/);
});
