# Changelog

All notable changes to Media Review. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/): a new feature bumps the middle
number, a fix the last one.

## [Unreleased]

### Added

- Sign in with Plex. Voters Downvote movies and shows, and withdraw a Downvote until the Title
  reaches the Review Queue. They're told when a Downvote won't count until they've tried the Title.
- The weighting and threshold rules: Sample, Base Weight, Title Bonus, Audience and Minimum Audience.
  Voters, play history and Titles come from Tautulli and Plex.
- Remove into Leaving Soon: 14 days in a "Leaving Soon" collection in each Plex library, pinned to
  everyone's Home and the library's Recommended tab, plus a Leaving Soon tab and a "Leaving in N days"
  label in the web app. The Owner can Keep after all, from Media Review or Media Ops. Nothing is
  deleted yet.
- The Owner's own Review Queue page with Keep, so Media Review works without Media Ops. Media Ops is
  an optional second place to decide, through the API: the Review Queue, and Keep.
- Titles sorted by Plex library: a tab per library (Movies, TV Shows, Anime…, as named and ordered in
  Plex), and each title labelled with its library.
- The same look as Media Ops: colours, light mode, the Inter font, cards and buttons.
- A Docker image (`ghcr.io/kaiserhomelab/media-review`) on the linuxserver.io Alpine base, and an
  Unraid template.
