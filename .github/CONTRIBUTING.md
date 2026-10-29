# Contributing to Media Review

Thanks for helping out! Bug reports, ideas and pull requests are all welcome. For security
problems, please use [private reporting](SECURITY.md) instead of a public issue.

## Getting started

You need Node.js 24 or newer (for `node:sqlite`). The app has no runtime dependencies; `npm ci`
only installs the development tools (ESLint, Prettier and TypeScript's checker).

```bash
git clone https://github.com/KaiserHomeLab/media-review.git
cd media-review/src    # the app and its tools live in src/
npm ci
npm start             # http://localhost:8485; first setup asks for the code printed in the terminal
```

`npm start` runs it for real, against your own Plex. Settings live in the database in `src/data/`.
To build the image, run `docker build -f src/Dockerfile -t media-review .` from the top of the
repo.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8485` | Web app and API port (Media Ops uses 8484) |
| `DATA_DIR` | `src/data` | Where the database lives: every Downvote, decision and setting, the apps included |
| `SYNC_MINUTES` | `15` | How often to read Plex and Tautulli |
| `TZ` | the system's | The time zone that decides when "overnight" is, for deletions |

## Before you open a pull request

```bash
npm run lint          # ESLint
npm run format        # Prettier (or format:check to only check)
npm run typecheck     # TypeScript's checker on the JavaScript
npm test              # unit and server tests (node --test)
```

CI runs the same checks on every pull request, then builds the image and smoke-tests it. Please
add or update a test for any change in behaviour, and add user-visible changes to `CHANGELOG.md`
(at the top of the repo) under **Unreleased**. The words in the code and the pages follow
[CONTEXT.md](../CONTEXT.md): a Downvote, a Voter, the Audience, Leaving Soon.

## How the repo is laid out

The top level holds what people installing Media Review need (README, Unraid template,
changelog, license) and the docs (`CONTEXT.md`, `docs/spec.md`). Everything that builds the image
is in `src/`:

| Where (in `src/`) | What |
|---|---|
| `Dockerfile`, `root/` | The image: linuxserver.io's Alpine base plus the s6 start-up scripts |
| `server.js` | Starts everything: the web server, the sync, overnight deletion, the Discord bot |
| `lib/rules.js`, `lib/review.js` | The rules (Sample, Vote Weight, the threshold) and what they do to the store |
| `lib/store.js` | Everything Media Review keeps, in one SQLite file |
| `lib/web.js` | Sign in with Plex, first setup, the pages' API and the API for Media Ops |
| `lib/plex.js`, `tautulli.js`, `arr.js`, `seerr.js` | The apps it talks to |
| `lib/problems.js`, `holdback.js`, `notices.js`, `bot.js`, `discord.js` | Problem Reports, holding back deleted titles, Discord messages and the bot |
| `public/` | The pages, as plain files (no build step) |
| `test/` | Tests (`node --test`), with fake apps in each test |

## Types

The code is plain JavaScript, checked by TypeScript (`npm run typecheck`) in strict mode using
JSDoc comments; nothing is compiled. Every function parameter has a JSDoc type.

## Rules that keep it safe

- **No runtime dependencies.** Node's standard library only; the pages load only our own files.
- **Secrets never reach the browser.** API keys, the Plex token and the Discord bot token are
  sent to the app they belong to and nowhere else.
- **Voters only ever see their own** Downvotes, Objections, reports and asks. Who Downvoted or
  objected is shown to the Owner only, and never in a Discord announcement.
- **Nothing is deleted without the Owner.** Deleting only ever follows a Remove whose Leaving
  Soon has run out.

## Releasing

1. Move the "Unreleased" notes in `CHANGELOG.md` under a new `## [x.y.z] - date` heading, and set
   the same version in `src/package.json`.
2. Merge that, then tag it: `git tag vx.y.z && git push origin vx.y.z`.
3. CI publishes `ghcr.io/kaiserhomelab/media-review:x.y.z` and `:x.y`, and makes the GitHub
   release from the changelog. Every merge to `main` also publishes `:latest`.
