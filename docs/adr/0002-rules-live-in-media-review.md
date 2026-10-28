---
status: accepted, amended by ADR 0003 (Media Review also has its own Owner screens)
---

# The rules live in Media Review, not in Media Ops

Media Ops is the Owner's own dashboard, but it is also a public project other people install, and it has no idea of individual users. So Media Review is a separate app that stores every Downvote, Objection and Problem Report, applies all of the weighting and threshold rules, keeps the Review Queue, and carries out each Keep and Remove itself (the Leaving Soon collection in Plex, deletion through Sonarr/Radarr, holding back Seerr re-requests). Media Ops only adds Media Review the way it adds any other app, shows the Review Queue, and sends the Owner's decisions back.

## Considered Options

- **Add a friend-facing side to Media Ops.** One app and one container, but it would put a second kind of login next to controls that can stop streams and clear logs.
- **Let Media Ops own the rules, with Media Review as a front door only.** This would put one server's house rules into a dashboard other people install.
- **Split storage and counting between the two apps.** Two apps would each hold half of the same decision.

## Consequences

- Media Review needs its own Plex, Tautulli, Sonarr/Radarr and Seerr keys.
- Media Review keeps working while Media Ops is down. Since [ADR 0003](0003-media-review-works-without-media-ops.md), the Owner can still decide in Media Review's own web app.
