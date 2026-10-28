# Media Review

Friends who use a Plex server Downvote movies and shows they think should leave the library. When enough of the people who've actually tried a Title agree, it goes to the Review Queue, and the Owner decides Keep or Remove from [Media Ops](https://github.com/KaiserHomeLab/media-ops). Nothing is ever removed automatically.

- What the words mean: [CONTEXT.md](CONTEXT.md)
- What it does: [docs/spec.md](docs/spec.md)
- What's being built: [docs/tickets/](docs/tickets/README.md)
- Why it's built this way: [docs/adr/](docs/adr/)

## Installing on Unraid

Media Review runs as a Docker container, `ghcr.io/kaiserhomelab/media-review`, next to Plex and Tautulli.

1. Save [`unraid-template.xml`](unraid-template.xml) as `/boot/config/plugins/dockerMan/templates-user/my-media-review.xml`, then go to **Docker → Add Container → Template: media-review**.
2. Set **Network Type** to the custom network Plex and Tautulli are on. Media Review then reaches them by container name: the defaults are `http://plex:32400` and `http://tautulli:8181`. If Plex runs on host networking, use the server's LAN IP for Plex instead.
3. Fill in the Plex token, the Tautulli API key, and the **Public address** (below).
4. Keep **Appdata** on the cache pool. SQLite is unreliable through `/mnt/user`'s FUSE layer unless appdata is an exclusive share, so use `/mnt/cache/appdata/media-review` if it isn't.
5. Apply, then open the web UI and sign in with Plex as the server owner. Open **API key**, generate a key, and add Media Review in Media Ops under Settings → Add app with `http://media-review:8485` and that key.

**Reaching it from outside, with a Cloudflare Tunnel:** add a public hostname, for example `review.example.com`, with the service `http://media-review:8485`. The cloudflared container must be on the same custom network. Set **Public address** to `https://review.example.com`, so Plex sign-in comes back there and session cookies are Secure.

Logs are capped at 3 × 10 MB, the health check uses `/healthz`, and the container runs as PUID/PGID (99:100 by default, like other Unraid apps).

## Running it without Docker

Node.js 24 or newer, no npm dependencies.

```sh
cd src
PLEX_URL=http://plex:32400 PLEX_TOKEN=… \
TAUTULLI_URL=http://tautulli:8181 TAUTULLI_API_KEY=… \
npm start
```

| Variable | Required | Meaning |
|---|---|---|
| `PLEX_URL` | yes | The Owner's Plex server, as Media Review can reach it |
| `PLEX_TOKEN` | yes | The Owner's Plex token, for reading the libraries and posters |
| `TAUTULLI_URL` | yes | Tautulli, for play history |
| `TAUTULLI_API_KEY` | yes | Tautulli → Settings → Web Interface → API |
| `PUBLIC_URL` | no | The address friends open, e.g. `https://review.example.com`. Sign-in returns there, and cookies are Secure when it's https |
| `PORT` | no | Default `8485` (Media Ops uses 8484) |
| `DATA_DIR` | no | Where the SQLite file lives. Default `src/data` |
| `SYNC_MINUTES` | no | How often to pull from Plex and Tautulli. Default `15` |

Voters sign in with Plex at the app's address. The Owner signs in the same way, opens **API key**, generates a key, and adds Media Review in Media Ops under Settings → Add app with this address and that key.

Behind a reverse proxy without `PUBLIC_URL`, pass `X-Forwarded-Proto` and `X-Forwarded-Host`, so Plex sign-in comes back to the right address and cookies are marked Secure.

## API for Media Ops

Every request sends the key as `X-Api-Key`.

- `GET /api/v1/status`: `{ app: "media-review", version }`
- `GET /api/v1/review-queue`: `{ reviewQueue: [...] }`, one entry per Title waiting for the Owner, with each Downvote's Voter and Vote Weight
- `GET /api/v1/poster/:ratingKey`: the Title's poster

## Development

```sh
cd src
npm install   # lint, format and typecheck tools only
npm test
npm run lint && npm run typecheck && npm run format:check
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck and the tests on every pull request, then builds the image and smoke-tests it. On `main` it publishes `:latest`.

## Releasing

1. Move the "Unreleased" notes in `CHANGELOG.md` under a new `## [x.y.z] - date` heading, and set the same version in `src/package.json`.
2. Merge that, then tag it: `git tag vx.y.z && git push origin vx.y.z`.
3. CI publishes `ghcr.io/kaiserhomelab/media-review:x.y.z` and `:x.y`, and makes the GitHub release from the changelog.
