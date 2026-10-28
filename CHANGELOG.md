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
- An API for Media Ops: the Review Queue, and Keep.
- A Docker image (`ghcr.io/kaiserhomelab/media-review`) on the linuxserver.io Alpine base, and an
  Unraid template.
