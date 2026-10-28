# 0011: Owner settings

**Blocked by:** 0001

## What to build

- An Owner-only settings page for every value in the spec's Settings table, starting from the defaults.
- Changing a setting re-runs the threshold check for every Title that isn't queued. It never takes a Title out of the queue.
- Anime and TV get separate Sample lengths. Anime has its own Plex library (Q2, answered), so the Owner picks which Plex libraries are anime, and Titles in them use the anime Sample length.

## Acceptance criteria

- [ ] Only the Owner can open or change settings.
- [ ] Lowering the Minimum Audience or Downvote share can queue Titles right away. Raising them never takes a Title out of the queue.
- [ ] Anime and TV can have different Sample lengths, and each Title uses the right one.
- [ ] Invalid values are rejected: negative values, a share over 100%, a Minimum Audience below 1.
