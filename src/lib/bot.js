// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// The Discord bot's slash commands: Downvote, withdraw, Objection, Problem Report, and the Voter's own list.
// They go through the same rules as the web app. Every reply is private to the person who used the command,
// so nobody sees who Downvoted what. Someone whose Discord isn't linked gets a one-time link to connect it,
// and nothing is recorded.
'use strict';
const crypto = require('node:crypto');
const { castDownvote, withdrawDownvote, object, withdrawObjection, sampledBy, leavingSoon } = require('./review');
const { sampleKind, sampleMinutes } = require('./rules');
const problems = require('./problems');
const holdback = require('./holdback');
const { EPHEMERAL } = require('./discord');

const LINK_MINUTES = 30;

/** @param {string} description */
const TITLE = description => ({ type: 3, name: 'title', description, required: true, autocomplete: true });
const COMMANDS = [
  {
    name: 'downvote',
    description: 'Tell the Owner a movie or show is no longer wanted',
    options: [TITLE('The movie or show')],
  },
  {
    name: 'withdraw',
    description: 'Take back your Downvote or Objection',
    options: [TITLE('One you Downvoted or objected to')],
  },
  {
    name: 'object',
    description: 'Ask the Owner to look again at something Leaving Soon',
    options: [TITLE('A title Leaving Soon')],
  },
  {
    name: 'report',
    description: 'Report a broken or poor copy so the Owner can replace it',
    options: [
      TITLE('The movie or show'),
      {
        type: 3,
        name: 'problem',
        description: "What's wrong",
        required: true,
        choices: Object.entries(problems.REASONS).map(([value, name]) => ({ name, value })),
      },
      { type: 3, name: 'part', description: 'For a show: the whole show, a season or one episode', autocomplete: true },
      { type: 3, name: 'note', description: 'What happens? Needed for Other', max_length: 500 },
    ],
  },
  { name: 'mine', description: 'Your Downvotes, Objections, Problem Reports and asks' },
  { name: 'link', description: 'Connect your Discord account to Media Review' },
  { name: 'unlink', description: 'Disconnect your Discord account from Media Review' },
];

const ERRORS = /** @type {Record<string, string>} */ ({
  'already-downvoted': 'You already Downvoted this.',
  queued: 'This is already with the Owner for review.',
  leaving: "This is already Leaving Soon, so it can't be Downvoted.",
  'unknown-title': 'That title is no longer in the library.',
  'not-downvoted': "You hadn't Downvoted this.",
  downvoted: "You Downvoted this, so you can't also object to it going.",
  'objections-closed': 'This was sent back once already, so it takes no Objections this time.',
  'already-objected': 'You already objected to this.',
  'not-leaving': "This isn't Leaving Soon.",
  'pick-a-reason': "Pick what's wrong.",
  'say-what': 'Say what the problem is in `note`: it is needed for Other.',
  'unknown-part': "That season or episode isn't in Plex.",
  'already-reported': "You've already reported this problem.",
});

/**
 * @typedef {{ store: import('./store').Store, settings: import('./rules').Settings, now: () => number,
 *   plex: { episodes: (key: string) => Promise<Array<{ season: number, episode: number, title: string }>> },
 *   publicUrl: () => string | null, leavingChanged: () => void, log: (msg: string) => void }} BotCtx
 */

/** @param {any} i */
const userOf = i => i.member?.user ?? i.user ?? {};
/** @param {any} i @param {string} name */
const opt = (i, name) => (i.data?.options ?? []).find((/** @type {any} */ o) => o.name === name)?.value;
/** @param {import('./store').TitleRow} t */
const label = t => `${t.title}${t.year ? ` (${t.year})` : ''}${t.library ? ` · ${t.library}` : ''}`.slice(0, 100);
/** @param {import('./store').TitleRow} t */
const choice = t => ({ name: label(t), value: t.rating_key });

// The one-time link that connects this Discord account, after signing in with Plex. null when Media Review
// doesn't know the address people reach it on.
/** @param {BotCtx} ctx @param {any} user */
function linkUrl(ctx, user) {
  const base = ctx.publicUrl();
  if (!base) return null;
  const token = crypto.randomBytes(24).toString('base64url');
  ctx.store.addLinkToken(token, String(user.id), user.global_name ?? user.username ?? null, ctx.now());
  return `<${base}/link.html?t=${token}>`;
}
const NO_ADDRESS =
  "Media Review doesn't know its own address, so it can't give you a link. Ask the Owner to set the public address under Settings.";
const HOW = `Sign in with Plex there and press Connect. The link works once, for ${LINK_MINUTES} minutes.`;

// What the person typed for a title: normally the pick from the list (its id); else an exact name.
/** @param {BotCtx} ctx @param {unknown} v */
function titleFrom(ctx, v) {
  const s = String(v ?? '');
  return ctx.store.title(s) ?? ctx.store.searchTitles(s, 5).find(t => t.title.toLowerCase() === s.trim().toLowerCase());
}

/** @param {BotCtx} ctx @param {any} i @returns {Promise<Array<{ name: string, value: string }>>} */
async function autocomplete(ctx, i) {
  const link = ctx.store.linkOf(String(userOf(i).id));
  if (!link) return [];
  const focused = (i.data?.options ?? []).find((/** @type {any} */ o) => o.focused);
  const q = String(focused?.value ?? '').toLowerCase();
  if (focused?.name === 'part') {
    const t = titleFrom(ctx, opt(i, 'title'));
    if (!t || t.kind !== 'show') return [{ name: 'The whole movie', value: 'all' }];
    const eps = await ctx.plex.episodes(t.rating_key);
    const seasons = [...new Set(eps.map(e => e.season))];
    const all = [
      { name: 'The whole show', value: 'all' },
      ...seasons.map(s => ({ name: s === 0 ? 'Specials' : `Season ${s}`, value: `s:${s}` })),
      ...eps.map(e => ({
        name: problems.partOf({ season: e.season, episode: e.episode, episode_title: e.title }) ?? '',
        value: `e:${e.season}:${e.episode}`,
      })),
    ];
    return all
      .filter(c => c.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map(c => ({ ...c, name: c.name.slice(0, 100) }));
  }
  const name = i.data?.name;
  if (name === 'object') {
    const now = ctx.now();
    return leavingSoon(ctx.store, now)
      .map(l => ctx.store.title(l.ratingKey))
      .filter(t => !!t && t.title.toLowerCase().includes(q))
      .slice(0, 25)
      .map(t => choice(/** @type {import('./store').TitleRow} */ (t)));
  }
  if (name === 'withdraw') {
    const keys = [...ctx.store.downvotedBy(link.plex_id), ...ctx.store.objectedBy(link.plex_id)];
    return keys
      .map(k => ctx.store.title(k))
      .filter(t => !!t && t.title.toLowerCase().includes(q))
      .slice(0, 25)
      .map(t => choice(/** @type {import('./store').TitleRow} */ (t)));
  }
  return ctx.store.searchTitles(q, 25).map(choice);
}

/** @param {BotCtx} ctx @param {any} i @returns {Promise<string>} the private reply */
async function command(ctx, i) {
  const { store, settings, now } = ctx;
  const user = userOf(i);
  const name = i.data?.name;
  const link = store.linkOf(String(user.id));
  if (name === 'unlink') {
    if (!link) return "Your Discord isn't connected to Media Review.";
    store.unlink(link.plex_id);
    ctx.log(`Discord unlinked: ${user.username ?? user.id}`);
    return 'Disconnected. Use /link to connect again.';
  }
  if (!link || name === 'link') {
    const url = linkUrl(ctx, user);
    const v = link && store.voter(link.plex_id);
    const head = !link
      ? name === 'link'
        ? 'Connect your Discord to Media Review:'
        : 'Connect your Discord to Media Review first. Nothing was recorded.'
      : `You're connected as ${v?.username ?? 'the Owner'} on Plex. To connect a different Plex account instead:`;
    return url ? `${head}\n${url}\n${HOW}` : `${head}\n${NO_ADDRESS}`;
  }
  const voterId = link.plex_id;
  const isOwner = !store.voter(voterId);
  if (name === 'mine') return mine(ctx, voterId);
  if (isOwner)
    return 'You are the Owner: you decide on the Review Queue in Media Review, and do not Downvote, object or report.';

  const t = titleFrom(ctx, opt(i, 'title'));
  if (!t) return 'Pick a title from the list that comes up as you type.';
  const what = label(t);
  if (name === 'downvote') {
    const r = castDownvote(store, settings, voterId, t.rating_key, now());
    if (!r.ok) return ERRORS[r.error] ?? r.error;
    const counts = sampledBy(store, settings, voterId)(t);
    return counts
      ? `▼ Downvoted ${what}.`
      : `▼ Downvoted ${what}. It counts once you've watched ${sampleMinutes(sampleKind(t, settings), settings)} minutes of it.`;
  }
  if (name === 'withdraw') {
    if (store.downvotedBy(voterId).has(t.rating_key)) {
      const r = withdrawDownvote(store, settings, voterId, t.rating_key, now());
      return r.ok ? `Withdrew your Downvote on ${what}.` : (ERRORS[r.error] ?? r.error);
    }
    if (store.objectedBy(voterId).has(t.rating_key)) {
      const r = withdrawObjection(store, voterId, t.rating_key);
      return r.ok ? `Withdrew your Objection to ${what} going.` : (ERRORS[String(r.error)] ?? String(r.error));
    }
    return "You haven't Downvoted or objected to that.";
  }
  if (name === 'object') {
    const r = object(store, settings, voterId, t.rating_key, now());
    if (!r.ok) return ERRORS[r.error] ?? r.error;
    if (r.sentBack) {
      ctx.log(`Sent back by Objections (Discord): ${t.title}`);
      ctx.leavingChanged();
      return `▲ Objected, and that sent ${what} back: the Owner will look at it again.`;
    }
    return `▲ Objected to ${what} going. The Owner looks again if enough people object.`;
  }
  if (name === 'report') {
    const part = String(opt(i, 'part') ?? 'all');
    const m = part.match(/^(?:s:(\d+)|e:(\d+):(\d+))$/);
    if (part !== 'all' && !m) return 'Pick the part from the list that comes up as you type.';
    const r = await problems.report(
      store,
      voterId,
      {
        titleKey: t.rating_key,
        season: m ? (m[1] ?? m[2]) : null,
        episode: m?.[3] ?? null,
        reason: opt(i, 'problem'),
        note: opt(i, 'note'),
      },
      now(),
      k => ctx.plex.episodes(k),
    );
    if (!r.ok) return ERRORS[r.error] ?? r.error;
    ctx.log(`Problem Report${r.joined ? ' (me too)' : ''} (Discord): ${t.title}`);
    return r.joined
      ? `⚑ Someone already reported that on ${what}: added you to it. You'll hear what the Owner does.`
      : `⚑ Sent to the Owner: ${what}. You'll hear when it's resolved or closed; /mine shows it meanwhile.`;
  }
  return 'Media Review does not know that command.';
}

// The Voter's own things, never anyone else's.
/** @param {BotCtx} ctx @param {string} voterId */
function mine(ctx, voterId) {
  const { store } = ctx;
  /** @param {Iterable<string>} keys */
  const names = keys =>
    [...keys]
      .map(k => store.title(k))
      .filter(t => !!t)
      .map(t => label(/** @type {import('./store').TitleRow} */ (t)));
  const down = names(store.downvotedBy(voterId));
  const obj = names(store.objectedBy(voterId));
  const reports = problems.reportsBy(store, voterId, ctx.now()).filter(r => !r.outcome);
  const asks = holdback.asksBy(store, voterId, ctx.now()).filter(a => !a.outcome);
  const lines = [];
  if (down.length) lines.push(`**Downvoted** (${down.length}): ${down.join(', ')}`);
  if (obj.length) lines.push(`**Objected**: ${obj.join(', ')}`);
  if (reports.length)
    lines.push(
      `**Open Problem Reports**: ${reports.map(r => `${r.title.name} (${r.reasonLabel}${r.part ? `, ${r.part}` : ''})`).join(', ')}`,
    );
  if (asks.length) lines.push(`**Asked back**: ${asks.map(a => a.title).join(', ')}`);
  const text = lines.length ? lines.join('\n') : 'Nothing yet: no Downvotes, Objections, open Problem Reports or asks.';
  return text.length > 1900 ? `${text.slice(0, 1900)}…\nSee the rest in Media Review.` : text;
}

// Answer one interaction. A command that takes longer than ~2.5 s (Plex is slow) is answered "thinking…"
// first, then the reply replaces it: Discord drops an interaction not answered within 3 s.
/** @param {BotCtx} ctx @param {import('./discord').Rest} api @param {string} appId @param {any} i */
async function handle(ctx, api, appId, i) {
  if (i.type === 4) {
    const choices = await autocomplete(ctx, i).catch(() => []);
    return api.respond(i.id, i.token, { type: 8, data: { choices } });
  }
  if (i.type !== 2) return;
  const reply = command(ctx, i).catch(e => `Something went wrong: ${e.message}`);
  const quick = await Promise.race([reply, new Promise(r => setTimeout(() => r(null), 2500))]);
  if (quick !== null)
    return api.respond(i.id, i.token, {
      type: 4,
      data: { content: quick, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
    });
  await api.respond(i.id, i.token, { type: 5, data: { flags: EPHEMERAL } });
  return api.editReply(appId, i.token, await reply);
}

// The bot as set up under Settings: connected while there is a token and a server, reconnected when either
// changes, and its commands registered in that server each time it connects.
/**
 * @param {BotCtx & { config: () => import('./apps').DiscordConfig | undefined,
 *   gateway?: typeof import('./discord').gateway, rest?: typeof import('./discord').rest }} ctx
 */
function botRunner(ctx) {
  const makeGateway = ctx.gateway ?? require('./discord').gateway;
  const makeRest = ctx.rest ?? require('./discord').rest;
  /** @type {{ stop: () => void } | null} */
  let running = null;
  let current = '';
  /** @type {{ connected: boolean, error: string | null } | null} */
  let status = null;
  const refresh = () => {
    const cfg = ctx.config();
    const key = cfg ? `${cfg.token}|${cfg.guildId}` : '';
    if (key === current) return;
    current = key;
    running?.stop();
    running = null;
    status = null;
    if (!cfg) return;
    const api = makeRest({ token: cfg.token });
    let appId = '';
    status = { connected: false, error: null };
    const g = makeGateway({
      token: cfg.token,
      rest: api,
      log: ctx.log,
      onStatus: s => (status = s),
      // Discord limits registering commands, and every reconnect is a READY: only send them when they changed.
      onReady: async ready => {
        appId = ready.applicationId;
        const sig = crypto
          .createHash('sha256')
          .update(JSON.stringify([appId, cfg.guildId, COMMANDS]))
          .digest('hex');
        if (ctx.store.getSetting('discordCommands') !== sig) {
          await api.setCommands(appId, cfg.guildId, COMMANDS);
          ctx.store.setSetting('discordCommands', sig);
          ctx.log(`Discord: connected as ${ready.username}, commands ready in ${cfg.guildName}`);
        } else ctx.log(`Discord: connected as ${ready.username}`);
      },
      // Only the Owner's server; the bot may be in others.
      onInteraction: i => (i.guild_id === cfg.guildId ? handle(ctx, api, appId, i) : undefined),
    });
    running = g;
    g.start();
  };
  return { refresh, status: () => status, stop: () => running?.stop() };
}

module.exports = { COMMANDS, handle, command, autocomplete, botRunner, LINK_MINUTES };
