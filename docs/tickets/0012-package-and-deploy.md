# 0012: Package and deploy on Unraid

**Blocked by:** 0001

**Status:** The image, Unraid template and CI are built, and proven locally: it runs as PUID/PGID, finds Plex and Tautulli by name on a user-defined network, keeps its data across a re-create, reports healthy, and has capped logs. Still to do on the Owner's server: deploy it on the custom network, add the Cloudflare Tunnel hostname, and check Q3 against the real Tautulli.

## What to build

- A Docker image for Media Review with its data on a mounted volume.
- Configuration for Plex, Tautulli, Sonarr, Radarr, Seerr and Discord keys, on the Settings page (kept in `/config`).
- Deploy it on the Owner's Unraid server, on the custom network Plex and Tautulli use, so it reaches them by name.
- Published to GHCR by CI (like Media Ops), installed with an Unraid template.
- Friends reach it through the Owner's Cloudflare Tunnel: a public hostname pointing at `http://media-review:8485`, entered under Settings → Public address.
- Check Q3 against the real Tautulli: the play durations and Watches Media Review stores match Tautulli's history for a few Voters.

## Acceptance criteria

- [ ] Re-creating the container keeps all Downvotes, Objections, Problem Reports and settings.
- [ ] Media Review reaches Plex, Tautulli, Sonarr, Radarr and Seerr from inside the container, and still does after a host reboot.
- [ ] Media Ops reaches the API at the configured address.
- [ ] Logs are size-limited.

## Checklist

The Owner works through a step-by-step checklist, with a check after each step:

1. Look at the networks.
2. Install from the template.
3. First setup.
4. The apps.
5. Q3 against Tautulli.
6. The Cloudflare Tunnel.
7. Media Ops.
8. Discord.
9. The whole loop, done safely.
10. Re-create and reboot.

It's published privately to the Owner at https://claude.ai/artifact/UUXSAYx3oZjbQEegb95Jew. Anything that doesn't match a check comes back here, with the step number, the log tail and any red tile's text.
