# 0012: Package and deploy on Unraid

**Blocked by:** 0001

## What to build

- A Docker image for Media Review with its data on a mounted volume.
- Configuration for Plex, Tautulli, Sonarr, Radarr, Seerr and Discord keys, through environment variables or the settings page.
- Deploy it on the Owner's Unraid server next to the other containers, so it can reach them by name.

## Acceptance criteria

- [ ] Re-creating the container keeps all Downvotes, Objections, Problem Reports and settings.
- [ ] Media Review reaches Plex, Tautulli, Sonarr, Radarr and Seerr from inside the container, and still does after a host reboot.
- [ ] Media Ops reaches the API at the configured address.
- [ ] Logs are size-limited.
