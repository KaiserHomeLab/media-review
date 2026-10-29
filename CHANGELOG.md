# Changelog

All notable changes to Media Review. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/): a new feature bumps the middle
number, a fix the last one.

## [Unreleased]

### Added

- Holding back deleted titles: with **Seerr** added under Settings, a title Media Review deletes goes
  on Seerr's blocklist, so it can't simply be requested and downloaded again. Friends find it under a
  **Gone** tab and can **Ask to bring it back**. You see who asked and why the title went (who
  Downvoted it and how much, Objections, Keeps, Removes, deletions), then **Bring back** (off the
  blocklist and requested in Seerr) or **Decline**, with an optional note. Titles deleted before this
  version are held back too.
- Problem Reports: a Voter reports a broken or poor copy of a movie, a whole show, a season or one
  episode, picking what's wrong and adding a note. Someone with the same problem says "me too" on the
  open one. The Owner resolves or closes it, with an optional note, on the Review Queue page or in
  Media Ops, and the reporters see the outcome under "Your Problem Reports". Never a Downvote.
- Sign in with Plex. Voters Downvote movies and shows, and withdraw a Downvote until the Title
  reaches the Review Queue. They're told when a Downvote won't count until they've tried the Title.
- The weighting and threshold rules: Sample, Base Weight, Title Bonus, Audience and Minimum Audience.
  Voters, play history and Titles come from Tautulli and Plex.
- Remove into Leaving Soon: 14 days in a "Leaving Soon" collection in each Plex library, pinned to
  everyone's Home and the library's Recommended tab, plus a Leaving Soon tab and a "Leaving in N days"
  label in the web app. The Owner can Keep after all, from Media Review or Media Ops.
- Deletion when Leaving Soon is over: overnight (04:00–07:00 server time), through Radarr and one or
  two Sonarrs (TV and anime), every copy, with an import-list exclusion. A Title that can't be
  deleted stays Leaving Soon with the reason shown to the Owner, and is tried again the next night.
- Objections: while a Title is Leaving Soon, friends who didn't Downvote it can ask for it to be kept.
  Each weighs what their Downvote would, and reaching the Objection bar (2: one friend who tried it)
  sends it back to the Review Queue, marked as sent back with who objected. Only once per round: Removed
  again, it takes no Objections.
- The Owner's own Review Queue page with Keep, so Media Review works without Media Ops. Media Ops is
  an optional second place to decide, through the API: the Review Queue, and Keep.
- Titles sorted by Plex library: a tab per library (Movies, TV Shows, Anime…, as named and ordered in
  Plex), and each title labelled with its library.
- The same look as Media Ops: colours, light mode, the Inter font, cards and buttons.
- A Docker image (`ghcr.io/kaiserhomelab/media-review`) on the linuxserver.io Alpine base, and an
  Unraid template.
- First setup in the web app: a one-time code from the log, then Plex sign-in as the server's owner,
  picking the server. A Settings page for the Owner: Plex, Tautulli, Radarr and Sonarrs (address, API
  key, Test, Save), the public address, and the Media Ops key. Apps are no longer container variables.
- Settings → Rules: every rule, with a reason next to any value that isn't right. Anime gets its own
  Sample length, for the Plex libraries the Owner ticks as anime. Saving checks every Title again, so
  a lower bar can queue some at once; nothing already queued is taken out.
