// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { DEFAULTS } = require('../lib/rules');
const { castDownvote, reviewQueue } = require('../lib/review');
const problems = require('../lib/problems');
const bot = require('../lib/bot');

const NOW = 1_800_000_000;

function setup({ publicUrl = 'https://review.example.com' } = {}) {
  const store = openStore(':memory:');
  store.replaceTitles([
    { ratingKey: 'm1', kind: 'movie', title: 'Dull Movie', year: 2020, library: 'Movies' },
    { ratingKey: 's1', kind: 'show', title: 'Slow Show', library: 'Anime' },
    { ratingKey: 'm2', kind: 'movie', title: 'Going Movie' },
  ]);
  for (const [id, name] of [
    ['a', 'alice'],
    ['b', 'bob'],
  ])
    store.upsertVoter({ plexId: id, username: name });
  store.remove('m2', NOW - 86400, NOW + 13 * 86400);
  let changed = 0;
  /** @type {import('../lib/bot').BotCtx} */
  const ctx = {
    store,
    settings: DEFAULTS,
    now: () => NOW,
    plex: {
      episodes: async () => [
        { season: 1, episode: 1, title: 'Pilot' },
        { season: 1, episode: 2, title: 'Two' },
      ],
    },
    publicUrl: () => publicUrl,
    leavingChanged: () => void changed++,
    log: () => {},
  };
  /** @param {string} discordId @param {string} name @param {Record<string, unknown>} [options] @param {string} [focused] */
  const interaction = (discordId, name, options = {}, focused) => ({
    id: 'i1',
    token: 'tok',
    guild_id: 'g1',
    member: { user: { id: discordId, username: `${discordId}-name`, global_name: `Discord ${discordId}` } },
    data: {
      name,
      options: Object.entries(options).map(([n, value]) => ({
        name: n,
        value,
        ...(n === focused ? { focused: true } : {}),
      })),
    },
  });
  /** @param {string} discordId @param {string} name @param {Record<string, unknown>} [options] */
  const run = (discordId, name, options) => bot.command(ctx, interaction(discordId, name, options));
  return { store, ctx, run, interaction, changed: () => changed };
}

test('an unlinked Discord user gets a one-time link, and nothing is recorded', async () => {
  const s = setup();
  const reply = await s.run('d-alice', 'downvote', { title: 'm1' });
  assert.match(reply, /Connect your Discord to Media Review first\. Nothing was recorded\./);
  const token = reply.match(/link\.html\?t=([\w-]+)>/)?.[1];
  assert.ok(token);
  assert.equal(s.store.linkToken(String(token), NOW - 60)?.discord_id, 'd-alice');
  assert.equal(s.store.downvotesOf('m1').length, 0);
  assert.equal(
    (await s.run('d-alice', 'report', { title: 'm1', problem: 'audio' })).includes('Nothing was recorded'),
    true,
  );
  assert.equal(problems.openReports(s.store).length, 0);
  assert.deepEqual(await bot.autocomplete(s.ctx, s.interaction('d-alice', 'downvote', { title: 'Du' }, 'title')), []);
});

test('without a public address the bot says so instead of giving a broken link', async () => {
  const s = setup({ publicUrl: /** @type {any} */ (null) });
  assert.match(await s.run('d-alice', 'link'), /doesn't know its own address/);
});

test('a Downvote from Discord counts the same as one on the web, once per Title', async () => {
  const s = setup();
  s.store.link('d-alice', 'a', 'Discord alice', NOW);
  assert.match(
    await s.run('d-alice', 'downvote', { title: 'm1' }),
    /^▼ Downvoted Dull Movie \(2020\) · Movies\. It counts once you've watched 30 minutes/,
  );
  assert.deepEqual(
    s.store.downvotesOf('m1').map(d => d.voter_id),
    ['a'],
  );
  assert.equal(await s.run('d-alice', 'downvote', { title: 'm1' }), 'You already Downvoted this.');
  assert.deepEqual(
    castDownvote(s.store, DEFAULTS, 'a', 'm1', NOW),
    { ok: false, error: 'already-downvoted' },
    'and on the web',
  );
  // typed rather than picked: an exact name works, anything else asks to pick
  assert.match(await s.run('d-alice', 'withdraw', { title: 'dull movie' }), /^Withdrew your Downvote/);
  assert.match(await s.run('d-alice', 'downvote', { title: 'Dull' }), /Pick a title from the list/);
});

test('Objection and withdrawing it, from Discord, on a Title Leaving Soon', async () => {
  const s = setup();
  s.store.link('d-bob', 'b', null, NOW);
  assert.equal(await s.run('d-bob', 'object', { title: 'm1' }), "This isn't Leaving Soon.");
  assert.match(await s.run('d-bob', 'object', { title: 'm2' }), /^▲ Objected to Going Movie going/);
  assert.deepEqual([...s.store.objectedBy('b')], ['m2']);
  assert.match(await s.run('d-bob', 'withdraw', { title: 'm2' }), /^Withdrew your Objection/);
  assert.deepEqual([...s.store.objectedBy('b')], []);
});

test('a Problem Report from Discord, on one episode, joins the same open report', async () => {
  const s = setup();
  s.store.link('d-alice', 'a', null, NOW);
  s.store.link('d-bob', 'b', null, NOW);
  const parts = await bot.autocomplete(s.ctx, s.interaction('d-alice', 'report', { title: 's1', part: 'two' }, 'part'));
  assert.deepEqual(parts, [{ name: 'S1 E2 · Two', value: 'e:1:2' }]);
  assert.match(
    await s.run('d-alice', 'report', { title: 's1', problem: 'audio', part: 'e:1:2', note: 'no sound' }),
    /^⚑ Sent to the Owner/,
  );
  assert.match(
    await s.run('d-bob', 'report', { title: 's1', problem: 'audio', part: 'e:1:2' }),
    /^⚑ Someone already reported that/,
  );
  assert.match(await s.run('d-bob', 'report', { title: 'm1', problem: 'other' }), /needed for Other/);
  const [r] = problems.openReports(s.store);
  assert.deepEqual([r.part, r.reporters.map(x => x.voter)], ['S1 E2 · Two', ['alice', 'bob']]);
  assert.equal(s.store.downvotesOf('s1').length, 0, 'never a Downvote');
});

test('/mine shows only their own Downvotes, Objections and reports', async () => {
  const s = setup();
  s.store.link('d-alice', 'a', null, NOW);
  s.store.link('d-bob', 'b', null, NOW);
  await s.run('d-alice', 'downvote', { title: 'm1' });
  await s.run('d-bob', 'object', { title: 'm2' });
  const alice = await s.run('d-alice', 'mine');
  assert.match(alice, /\*\*Downvoted\*\* \(1\): Dull Movie/);
  assert.doesNotMatch(alice, /Going Movie|Objected/);
  assert.match(await s.run('d-bob', 'mine'), /\*\*Objected\*\*: Going Movie/);
  assert.doesNotMatch(await s.run('d-bob', 'mine'), /Dull Movie/);
});

test('the Owner can link, but does not Downvote from Discord', async () => {
  const s = setup();
  s.store.link('d-owner', 'owner', null, NOW);
  assert.match(await s.run('d-owner', 'downvote', { title: 'm1' }), /You are the Owner/);
  assert.equal(reviewQueue(s.store).length, 0);
  assert.match(await s.run('d-owner', 'link'), /You're connected as the Owner/);
});

test('/reminders off and on', async () => {
  const s = setup();
  s.store.link('d-a', 'a', null, NOW);
  assert.match(await s.run('d-a', 'reminders', { set: 'off' }), /^Reminders off/);
  assert.equal(s.store.voter('a')?.reminders, 0);
  assert.match(await s.run('d-a', 'reminders', { set: 'on' }), /^Reminders on/);
  assert.equal(s.store.voter('a')?.reminders, 1);
  s.store.link('d-owner', 'owner', null, NOW);
  assert.match(await s.run('d-owner', 'reminders', { set: 'on' }), /Reminders are for friends/);
});

test('unlink and link again; linking a second Discord replaces the first', async () => {
  const s = setup();
  s.store.link('d-alice', 'a', null, NOW);
  assert.equal(await s.run('d-alice', 'unlink'), 'Disconnected. Use /link to connect again.');
  assert.match(await s.run('d-alice', 'downvote', { title: 'm1' }), /Nothing was recorded/);
  s.store.link('d-alice', 'a', null, NOW);
  s.store.link('d-alice-2', 'a', null, NOW);
  assert.equal(s.store.linkOf('d-alice'), undefined);
  assert.equal(s.store.linkOf('d-alice-2')?.plex_id, 'a');
});

test('autocomplete: titles to Downvote, only Leaving Soon to object, only their own to withdraw', async () => {
  const s = setup();
  s.store.link('d-alice', 'a', null, NOW);
  await s.run('d-alice', 'downvote', { title: 'm1' });
  /** @param {string} cmd @param {string} q */
  const ac = async (cmd, q) =>
    (await bot.autocomplete(s.ctx, s.interaction('d-alice', cmd, { title: q }, 'title'))).map(c => c.value);
  assert.deepEqual(await ac('downvote', 'movie'), ['m1', 'm2']);
  assert.deepEqual(await ac('object', ''), ['m2']);
  assert.deepEqual(await ac('withdraw', ''), ['m1']);
});

test('replies are private, and a slow one is answered "thinking" first, then edited', async () => {
  const s = setup();
  s.store.link('d-alice', 'a', null, NOW);
  const calls = /** @type {any[]} */ ([]);
  const api = /** @type {any} */ ({
    respond: async (/** @type {string} */ id, /** @type {string} */ token, /** @type {any} */ r) =>
      void calls.push(['respond', r]),
    editReply: async (/** @type {string} */ app, /** @type {string} */ token, /** @type {string} */ c) =>
      void calls.push(['edit', c]),
  });
  await bot.handle(s.ctx, api, 'app', { ...s.interaction('d-alice', 'mine'), type: 2 });
  assert.equal(calls[0][1].type, 4);
  assert.equal(calls[0][1].data.flags, 64, 'only they see it');

  calls.length = 0;
  const slow = {
    ...s.ctx,
    plex: { episodes: () => new Promise(r => setTimeout(() => r([{ season: 1, episode: 1, title: 'P' }]), 2700)) },
  };
  await bot.handle(slow, api, 'app', {
    ...s.interaction('d-alice', 'report', { title: 's1', problem: 'video', part: 's:1' }),
    type: 2,
  });
  assert.deepEqual(
    calls.map(c => (c[0] === 'respond' ? c[1].type : 'edit')),
    [5, 'edit'],
  );
  assert.match(calls[1][1], /^⚑ Sent to the Owner/);
});

test('the bot connects once set up, registers its commands in that server, answers only there, and reconnects on change', async () => {
  const s = setup();
  /** @type {any} */
  let cfg;
  const made = /** @type {any[]} */ ([]);
  const registered = /** @type {any[]} */ ([]);
  const responded = /** @type {any[]} */ ([]);
  const runner = bot.botRunner({
    ...s.ctx,
    config: () => cfg,
    rest: /** @type {any} */ (
      () => ({
        setCommands: async (/** @type {string} */ app, /** @type {string} */ guild, /** @type {any[]} */ cmds) =>
          void registered.push([app, guild, cmds.map(c => c.name)]),
        respond: async (/** @type {string} */ id) => void responded.push(id),
      })
    ),
    gateway: /** @type {any} */ (
      (/** @type {any} */ g) => {
        const handle = {
          g,
          started: false,
          stopped: false,
          start: () => (handle.started = true),
          stop: () => (handle.stopped = true),
        };
        made.push(handle);
        return handle;
      }
    ),
  });
  runner.refresh();
  assert.equal(made.length, 0, 'nothing until Discord is set up');
  cfg = { token: 't1', guildId: 'g1', guildName: 'Home', botName: 'MR' };
  runner.refresh();
  runner.refresh();
  assert.equal(made.length, 1, 'once, however often Settings are saved');
  await made[0].g.onReady({ applicationId: 'app1', username: 'MR' });
  assert.deepEqual(registered, [
    ['app1', 'g1', ['downvote', 'withdraw', 'object', 'report', 'mine', 'reminders', 'link', 'unlink']],
  ]);
  await made[0].g.onReady({ applicationId: 'app1', username: 'MR' }); // a reconnect
  assert.equal(registered.length, 1, 'commands are only sent again when they change');
  await made[0].g.onInteraction({ ...s.interaction('d-x', 'mine'), type: 2, id: 'here', guild_id: 'g1' });
  await made[0].g.onInteraction({ ...s.interaction('d-x', 'mine'), type: 2, id: 'elsewhere', guild_id: 'g2' });
  assert.deepEqual(responded, ['here']);
  cfg = { ...cfg, guildId: 'g2' };
  runner.refresh();
  assert.deepEqual([made[0].stopped, made.length, made[1].started], [true, 2, true]);
  cfg = undefined;
  runner.refresh();
  assert.equal(made[1].stopped, true);
  assert.equal(runner.status(), null);
});
