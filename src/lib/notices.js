// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// Discord announcements and the Owner's messages. Nothing posts to Discord straight from a
// decision: collect() looks at what has happened and records one notice per event, under a key that names it
// (leaving:<title>:<when>…), so running it again records nothing new. deliver() then sends what hasn't gone,
// oldest first, and keeps the rest for next time if Discord is down. Only events from when the Owner set the
// channels are sent, so turning this on doesn't announce the past.
//
// Announcements (the channel everyone sees) never name who Downvoted or objected. The Owner's channel does.
'use strict';
const crypto = require('node:crypto');
const problems = require('./problems');

/** @typedef {import('./store').Store} Store */
/** @typedef {{ title?: string, description?: string, color?: number, thumbnail?: { url: string }, url?: string }} Embed */
/** @typedef {{ content?: string, embeds?: Embed[] }} Message */

const DAY = 86400;
const HOUR = 3600;
const COLOR = { leaving: 0xd03b3b, reminder: 0xd03b3b, kept: 0x0ca30c, back: 0x9b7fe6, resolved: 0x4a90e2 };

// A poster Discord can fetch without signing in: only for a Title Media Review announced, by a signed link.
/** @param {Store} store */
function posterSecret(store) {
  let s = store.getSetting('posterSecret');
  if (!s) store.setSetting('posterSecret', (s = crypto.randomBytes(24).toString('base64url')));
  return s;
}
/** @param {Store} store @param {string} key */
const posterSig = (store, key) =>
  crypto.createHmac('sha256', posterSecret(store)).update(key).digest('base64url').slice(0, 22);
/** @param {Store} store @param {string} key @param {string} sig */
const posterOk = (store, key, sig) => {
  const want = Buffer.from(posterSig(store, key));
  const got = Buffer.from(String(sig));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};

/** @param {number} t @param {string} [tz] */
const date = (t, tz) =>
  new Date(t * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });

/**
 * @param {{ store: Store, now: number, publicUrl: string | null, tz?: string }} ctx
 * @param {string} key @returns {{ name: string, embedTitle: string, thumbnail?: { url: string } } | null}
 */
function titleBits(ctx, key) {
  const t = ctx.store.title(key);
  if (!t) return null;
  const name = `${t.title}${t.year ? ` (${t.year})` : ''}`;
  return {
    name,
    embedTitle: `${name}${t.library ? ` · ${t.library}` : ''}`,
    ...(ctx.publicUrl && t.thumb
      ? { thumbnail: { url: `${ctx.publicUrl}/cover/${encodeURIComponent(key)}/${posterSig(ctx.store, key)}` } }
      : {}),
  };
}

/** @param {number} n */
const num = n => String(Math.round(n * 100) / 100);

/**
 * Record a notice for everything that happened since the channels were set, and isn't recorded yet.
 * @param {{ store: Store, now: number, since: number, announce: boolean, owner: boolean, publicUrl: string | null,
 *   tz?: string, health?: Health }} ctx announce/owner: whether that channel is set
 * @returns {number} how many were recorded
 */
function collect(ctx) {
  const { store, now, since } = ctx;
  let n = 0;
  /** @param {string} key @param {string} target @param {Message} message */
  const add = (key, target, message) => void (store.addNotice(key, target, message, now) && n++);
  /** @param {string} key @param {Message} m */
  const announce = (key, m) => ctx.announce && add(key, 'announce', m);
  /** @param {string} key @param {string} text */
  const owner = (key, text) => ctx.owner && add(key, 'owner', { content: text });

  for (const l of store.leavingSoon()) {
    const t = titleBits(ctx, l.title_key);
    if (!t) continue;
    if (l.removed_at >= since)
      announce(`leaving:${l.title_key}:${l.removed_at}`, {
        embeds: [
          {
            title: `Leaving Soon: ${t.embedTitle}`,
            description: `Leaves ${date(l.ends_at, ctx.tz)}. Watch it before then${l.objections_closed ? '.' : ', or use /object to ask the Owner to keep it.'}`,
            color: COLOR.leaving,
            ...(t.thumbnail ? { thumbnail: t.thumbnail } : {}),
          },
        ],
      });
    // The day before it goes.
    if (now >= l.ends_at - DAY && now < l.ends_at && l.ends_at - DAY >= since)
      announce(`reminder:${l.title_key}:${l.ends_at}`, {
        embeds: [
          {
            title: `Last day: ${t.embedTitle}`,
            description: 'Leaves tonight. Last chance to watch it.',
            color: COLOR.reminder,
            ...(t.thumbnail ? { thumbnail: t.thumbnail } : {}),
          },
        ],
      });
    if (l.delete_error && l.ends_at >= since)
      owner(
        `failed:${l.title_key}:${l.ends_at}`,
        `⚠ Couldn't delete ${t.name}: ${l.delete_error}. It stays Leaving Soon and is tried again tonight.`,
      );
  }

  for (const q of store.reviewQueue()) {
    if (q.queued_at < since) continue;
    const t = titleBits(ctx, q.title_key);
    if (!t) continue;
    const who = store
      .queuedDownvotesOf(q.title_key)
      .map(d => `${d.username ?? d.voter_id} (${num(d.vote_weight)})`)
      .join(', ');
    if (q.sent_back) {
      const objectors = store
        .objectionsOf(q.title_key)
        .map(o => o.username ?? o.voter_id)
        .join(', ');
      owner(
        `sentback:${q.title_key}:${q.queued_at}`,
        `▲ Sent back by Objections: ${t.name}. ${objectors || 'Friends'} asked you to look again. It's back in the Review Queue.`,
      );
      announce(`staying:${q.title_key}:${q.queued_at}`, {
        embeds: [
          {
            title: `Not leaving for now: ${t.embedTitle}`,
            description: 'Friends asked the Owner to look at it again, so it is no longer Leaving Soon.',
            color: COLOR.kept,
            ...(t.thumbnail ? { thumbnail: t.thumbnail } : {}),
          },
        ],
      });
    } else
      owner(
        `queued:${q.title_key}:${q.queued_at}`,
        `▼ In the Review Queue: ${t.name}. ${num(q.downvote_weight)} of ${num(q.audience_weight)} weight from an Audience of ${q.audience}. Downvoted by ${who}.`,
      );
  }

  // Kept after all: a Keep straight after a Remove, while it was Leaving Soon.
  for (const d of store.decisionsSince(since)) {
    if (d.decision !== 'keep' || d.before !== 'remove') continue;
    const t = titleBits(ctx, d.title_key);
    if (t)
      announce(`kept:${d.title_key}:${d.at}`, {
        embeds: [
          {
            title: `Staying after all: ${t.embedTitle}`,
            description: 'It is no longer Leaving Soon.',
            color: COLOR.kept,
            ...(t.thumbnail ? { thumbnail: t.thumbnail } : {}),
          },
        ],
      });
  }

  for (const b of store.broughtBackSince(since)) {
    const t = titleBits(ctx, b.title_key);
    if (t)
      announce(`back:${b.title_key}:${b.at}`, {
        embeds: [
          {
            title: `Coming back: ${t.embedTitle}`,
            description: "The Owner brought it back. It's in the library again once it has downloaded.",
            color: COLOR.back,
            ...(t.thumbnail ? { thumbnail: t.thumbnail } : {}),
          },
        ],
      });
  }

  for (const p of store.problemsSince(since)) {
    const t = titleBits(ctx, p.title_key);
    const name = t?.name ?? p.title_key;
    const part = problems.partOf(p);
    const what = `${problems.REASONS[/** @type {keyof typeof problems.REASONS} */ (p.reason)] ?? p.reason}${part ? `, ${part}` : ''}`;
    if (p.created_at >= since) {
      const first = store.reportersOf(p.id)[0];
      owner(
        `problem:${p.id}`,
        `⚑ Problem Report: ${name} (${what}), from ${first?.username ?? 'a friend'}${first?.note ? `: “${first.note}”` : ''}.`,
      );
    }
    if (p.outcome && p.decided_at != null && p.decided_at >= since) {
      if (p.outcome === 'resolved')
        announce(`resolved:${p.id}`, {
          embeds: [
            {
              title: `Fixed: ${t?.embedTitle ?? name}`,
              description: `A reported problem (${what}) is resolved.${p.owner_note ? ` ${p.owner_note}` : ''}`,
              color: COLOR.resolved,
              ...(t?.thumbnail ? { thumbnail: t.thumbnail } : {}),
            },
          ],
        });
      // Everyone on the report who has linked Discord hears how it ended, privately.
      for (const r of store.reportersOf(p.id)) {
        const link = store.linkFor(r.voter_id);
        if (!link) continue;
        add(`problem-dm:${p.id}:${r.voter_id}`, `dm:${link.discord_id}`, {
          content: `${p.outcome === 'resolved' ? '✓ Resolved' : 'Closed'}: your Problem Report on ${name} (${what}).${p.owner_note ? ` The Owner says: ${p.owner_note}` : ''}`,
        });
      }
    }
  }

  for (const a of store.asksSince(since)) {
    const t = titleBits(ctx, a.title_key);
    owner(
      `ask:${a.id}`,
      `↺ ${a.username ?? 'A friend'} asked to bring back ${t?.name ?? a.title_key}${a.note ? `: “${a.note}”` : ''}. Decide on the Review Queue page.`,
    );
  }

  // An app that has been unreachable for an hour, once; and once more when it's back.
  for (const h of ctx.health?.failing() ?? []) {
    const at = new Date(h.since * 1000).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: ctx.tz,
    });
    if (now - h.since >= HOUR)
      owner(`trouble:${h.app}:${h.since}`, `⚠ Media Review can't reach ${h.app} (since ${at}): ${h.error}`);
  }
  for (const h of ctx.health?.recovered() ?? []) {
    if (store.hasNotice(`trouble:${h.app}:${h.since}`))
      owner(`recovered:${h.app}:${h.since}`, `✓ ${h.app} is reachable again.`);
  }
  return n;
}

// Which apps answer, from the checks after each sync: down since when, with what error, and which came back.
function health() {
  /** @type {Map<string, { since: number, error: string }>} */
  const down = new Map();
  /** @type {Array<{ app: string, since: number }>} */
  let back = [];
  return {
    /** @param {string} app */
    ok: app => {
      const d = down.get(app);
      if (d) back.push({ app, since: d.since });
      down.delete(app);
    },
    /** @param {string} app @param {string} error @param {number} now */
    fail: (app, error, now) => down.set(app, { since: down.get(app)?.since ?? now, error }),
    failing: () => [...down].map(([app, d]) => ({ app, ...d })),
    // Forget apps that are no longer set up.
    /** @param {string[]} apps */
    only: apps => {
      for (const app of down.keys()) if (!apps.includes(app)) down.delete(app);
    },
    // Those that came back since last asked.
    recovered: () => {
      const b = back;
      back = [];
      return b;
    },
  };
}
/** @typedef {ReturnType<typeof health>} Health */

/**
 * Send what hasn't gone yet, oldest first. A failure stops this round (keeping the order) and is kept on the
 * notice for Settings; a DM that can't be delivered (they left, or block DMs) is given up after 3 tries.
 * @param {{ store: Store, api: import('./discord').Rest, channels: { announce?: string, owner?: string },
 *   now: number, log: (msg: string) => void }} ctx
 * @returns {Promise<{ sent: number, error: string | null }>}
 */
async function deliver(ctx) {
  const { store, api } = ctx;
  let sent = 0;
  /** @type {Map<string, string>} Discord user → DM channel */
  const dms = new Map();
  for (const n of store.unsentNotices()) {
    const message = { ...JSON.parse(n.message), allowed_mentions: { parse: [] } };
    try {
      let channel = n.target === 'announce' ? ctx.channels.announce : n.target === 'owner' ? ctx.channels.owner : null;
      if (n.target.startsWith('dm:')) {
        const user = n.target.slice(3);
        channel = dms.get(user) ?? String((await api.call('POST', '/users/@me/channels', { recipient_id: user })).id);
        dms.set(user, channel);
      }
      if (!channel) {
        store.noticeSent(n.id, ctx.now); // its channel was unset since: nowhere to send it
        continue;
      }
      await api.call('POST', `/channels/${channel}/messages`, message);
      store.noticeSent(n.id, ctx.now);
      sent++;
    } catch (e) {
      store.noticeFailed(n.id, e.message);
      if (n.target.startsWith('dm:')) {
        if (n.tries + 1 >= 3) store.noticeSent(n.id, ctx.now);
        continue; // one person's DMs don't hold up the rest
      }
      if (!n.error) ctx.log(`Discord: couldn't post (${e.message}); trying again in a minute`);
      return { sent, error: e.message };
    }
  }
  return { sent, error: null };
}

module.exports = { collect, deliver, health, posterOk, posterSig };
