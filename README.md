# Media Review

Friends who use a Plex server Downvote movies and shows they think should leave the library. When enough of the people who've actually tried a Title agree, it goes to the Review Queue, and the Owner decides Keep or Remove from [Media Ops](https://github.com/KaiserHomeLab/media-ops). Nothing is ever removed automatically.

- What the words mean: [CONTEXT.md](CONTEXT.md)
- What it does: [docs/spec.md](docs/spec.md)
- What's being built: [docs/tickets/](docs/tickets/README.md)
- Why it's built this way: [docs/adr/](docs/adr/)

## Running it

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
| `PORT` | no | Default `8485` (Media Ops uses 8484) |
| `DATA_DIR` | no | Where the SQLite file lives. Default `src/data` |
| `SYNC_MINUTES` | no | How often to pull from Plex and Tautulli. Default `15` |

Voters sign in with Plex at the app's address. The Owner signs in the same way, opens **API key**, generates a key, and adds Media Review in Media Ops under Settings → Add app with this address and that key.

Behind a reverse proxy, pass `X-Forwarded-Proto` and `X-Forwarded-Host` so the Plex sign-in comes back to the right address and cookies are marked Secure.

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
