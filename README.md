# Media Review

Friends who use a Plex server Downvote movies and shows they think should leave the library. When enough of the people who've actually tried a Title agree, it goes to the Review Queue, and the Owner decides Keep or Remove on Media Review's own Review Queue page. Nothing is ever removed automatically.

It works on its own. If you also run [Media Ops](https://github.com/KaiserHomeLab/media-ops), you can connect the two and decide from either.

- What the words mean: [CONTEXT.md](CONTEXT.md)
- What it does: [docs/spec.md](docs/spec.md)
- What's being built: [docs/tickets/](docs/tickets/README.md)
- Why it's built this way: [docs/adr/](docs/adr/)

## Installing on Unraid

Media Review runs as a Docker container, `ghcr.io/kaiserhomelab/media-review`, next to Plex and Tautulli. Everything else is set up in its web app.

1. Save [`unraid-template.xml`](unraid-template.xml) as `/boot/config/plugins/dockerMan/templates-user/my-media-review.xml`, then go to **Docker → Add Container → Template: media-review**.
2. Set **Network Type** to the custom network Plex, Tautulli, Radarr and Sonarr are on, so Media Review can reach them by container name (`http://plex:32400`, `http://tautulli:8181`…).
3. Keep **Appdata** on the cache pool. SQLite is unreliable through `/mnt/user`'s FUSE layer unless appdata is an exclusive share, so use `/mnt/cache/appdata/media-review` if it isn't.
4. Apply, and open the container's log (**Docker → media-review → Logs**). It shows a one-time **setup code**; a new one is made at each start until setup is done.
5. Open the web UI and do **first setup**:
   1. Enter the setup code.
   2. Sign in with the Plex account that owns your server. You become Media Review's Owner.
   3. Pick the server, and the address Media Review uses to reach it, e.g. `http://plex:32400`.
6. On **Settings** (⚙ in the top bar), add **Tautulli**, which is needed for play history. Add **Radarr**, **Sonarr** and **Sonarr (anime)** if you want what you Remove to be deleted, and **Seerr** if you want deleted titles held back from being requested again. Each has **Test** and **Save**. Saved API keys are never shown again, and leaving the key blank keeps the saved one.

**Reaching it from outside, with a Cloudflare Tunnel:** add a public hostname, for example `review.example.com`, with the service `http://media-review:8485`. The cloudflared container must be on the same custom network. Then put `https://review.example.com` in **Settings → Public address**, so Plex sign-in comes back there and sign-in cookies stay on https. Do first setup before you open the tunnel, or keep the setup code private; it's what stops anyone else from claiming the install.

**Media Ops (optional):** on Settings, generate a key under **Media Ops**. Then add Media Review in Media Ops under Settings → Add app, with `http://media-review:8485` and that key.

Logs are capped at 3 × 10 MB, the health check uses `/healthz`, and the container runs as PUID/PGID (99:100 by default, like other Unraid apps). Deletions run overnight, 04:00–07:00, in the container's time zone (`TZ`, which Unraid sets).

## Discord (optional)

Friends can Downvote, withdraw, object and report from Discord with slash commands. Every reply is private to them.

1. Go to <https://discord.com/developers/applications>, press **New Application** and name it (for example Media Review).
2. Under **Bot**, press **Reset Token** and copy the token. No privileged intents are needed.
3. Under **OAuth2 → URL Generator**, tick `bot` and `applications.commands`, then open the link it makes and add the bot to your server.
4. In Media Review, go to **Settings → + Add app → Discord**. Paste the token, press **Test**, pick your server and **Save**.

The bot connects out to Discord, so commands work without a tunnel. The one-time link a friend gets to connect their account uses the **public address** set in Settings.

Commands: `/downvote`, `/withdraw`, `/object`, `/report`, `/mine`, `/link`, `/unlink`.

## Running it without Docker

Node.js 24 or newer, no npm dependencies.

```sh
cd src
npm start
```

Then open `http://localhost:8485` and follow first setup, with the code printed in the terminal.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8485` | Web app and API port (Media Ops uses 8484) |
| `DATA_DIR` | `src/data` | Where the database lives: every Downvote, decision and setting, the apps included |
| `SYNC_MINUTES` | `15` | How often to read Plex and Tautulli |
| `TZ` | the system's | The time zone that decides when "overnight" is, for deletions |

## API for Media Ops (optional)

Every request sends the key as `X-Api-Key`.

- `GET /api/v1/status`: `{ app: "media-review", version }`
- `GET /api/v1/review-queue`: `{ reviewQueue: [...] }`, one entry per Title waiting for the Owner, with each Downvote's Voter and Vote Weight
- `POST /api/v1/review-queue/:ratingKey/keep` and `…/remove`: the Owner's decision. Remove answers `{ removed: true, endsAt }`
- `GET /api/v1/leaving-soon`: `{ leavingSoon: [...] }`, each with `endsAt` and `daysLeft`
- `POST /api/v1/leaving-soon/:ratingKey/keep`: Keep after all
- `GET /api/v1/problem-reports`: `{ problemReports: [...] }`, the open Problem Reports, oldest first, each with its Title, the part (`"S2 E3 · Title"`, `"Season 2"`, or `null` for the whole Title), the reason, and every reporter with their note
- `POST /api/v1/problem-reports/:id/resolve` and `…/close`: the Owner's decision, with an optional `{ "note": "…" }` the reporters see
- `GET /api/v1/held-back`: `{ heldBack: [...] }`, deleted Titles blocklisted in Seerr, the ones friends asked for first, each with who asked and the Title's history
- `POST /api/v1/held-back/:ratingKey/bring-back` and `…/decline`: the Owner's decision, with an optional `{ "note": "…" }` for the friends who asked. Bring back takes it off Seerr's blocklist and requests it
- `GET /api/v1/poster/:ratingKey`: the Title's poster

The Owner's own pages use the same routes under `/api/owner/` with their session instead of the key.

Voters sign in with Plex at the app's address. The Owner signs in the same way and finds the **Review Queue** and **Settings** in the top bar.

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
