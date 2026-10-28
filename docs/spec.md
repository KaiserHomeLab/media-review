# Media Review: spec

Media Review lets the people the Owner's Plex server is shared with signal that a Title is no longer wanted. A weighted threshold sends a Title to the Review Queue, and the Owner decides Keep or Remove from Media Ops. Media Review holds every rule and carries out every decision (ADR 0002).

Terms are used exactly as defined in [CONTEXT.md](../CONTEXT.md). Where this spec and CONTEXT.md disagree, CONTEXT.md wins and this spec is fixed.

## Environment

- Runs as one Docker container on the Owner's Unraid server, next to Plex, Sonarr, Radarr, Tautulli and Seerr.
- Holds its own keys for Plex, Tautulli, Sonarr, Radarr, Seerr and Discord (ADR 0002, Consequences).
- Keeps working while Media Ops is down. Only the Owner's queue screen is unavailable then.

## Interfaces

### Web app

- "Sign in with Plex". The Plex account is the Voter identity. Only accounts the server is shared with, plus the Owner, can sign in.
- The Owner is the Plex server's owner account.
- Voters can browse Titles, cast and withdraw a Downvote, see Leaving Soon, make an Objection, file a Problem Report, and link a Discord account.
- Voters see only their own Downvotes and Objections. Only the Owner can see who cast each one.
- The Owner has a settings page for every value in [Settings](#settings).

### Discord bot

- A Discord account is linked once to a Plex sign-in, from the web app.
- Linked accounts can Downvote, make an Objection and file a Problem Report from Discord.
- An unlinked Discord user who tries any of those gets a prompt with a link to connect their account in the web app. Nothing is recorded.
- Announcements to the server channel: a Title entering Leaving Soon, and a resolved Problem Report (the reporter is told directly too).
- Messages to the Owner: a Title entering the Review Queue, and an Objection sending a Title back to the Owner.

### API for Media Ops

- Authenticated with an API key that the Owner generates in Media Review settings.
- Media Ops adds Media Review under Settings → Add app with an address and the API key, the same way it adds Sonarr or Tautulli.
- Read: the Review Queue and open Problem Reports, each with what the Owner needs to decide (see below).
- Write: Keep, Remove, and resolve or close a Problem Report.
- Media Ops is a public project. The integration is optional there and holds no downvote rules: it only displays what the API returns and sends decisions back.

A Review Queue entry includes: the Title, its Audience size, the Downvote weight against the Audience's total Vote Weight, each Downvote with its Voter and Vote Weight, any Watch by a downvoter after the Title was queued, whether it came back through Objections, and its Keep/Remove history.

## Domain rules

### Watch and Sample

- Play history comes from Tautulli.
- A Watch is a play Tautulli counts as finished: a whole movie or one full episode.
- A Sample is reached when a Voter's play time on a Title, added up across all its episodes and sessions, reaches the Sample length for its kind (movie, or TV and anime). Any Watch is also a Sample.
- Plays shorter than the Sample length that are not Watches count as neither.

### Vote Weight

- Vote Weight = Base Weight + Title Bonus.
- Base Weight ranges from 0 (no watching in the window) to 1 (heavy user), from the Voter's watching on the whole server over the Base Weight window.
- Title Bonus applies on a Title the Voter has Sampled.
- Vote Weight is computed when the threshold is checked, not frozen at the moment of the Downvote. Once a Title is queued, its Downvotes are frozen (see below).

### Reaching the Review Queue

A Title is added to the Review Queue when both of these are true:

1. Its Audience is at least the Minimum Audience.
2. The Vote Weight of the Audience members who Downvoted it is at least the Downvote share of the Audience's total Vote Weight.

The check runs whenever a Downvote is cast or withdrawn and whenever new play history changes a Title's Audience or any Vote Weight. Downvotes on a Title below the Minimum Audience are kept and count once the Audience reaches it.

### Downvotes

- One Downvote per Voter per Title. A Title is a whole movie or a whole show.
- A Downvote never removes anything by itself and never expires on a timer.
- Before the Title is queued:
  - the Voter can withdraw their own Downvote.
  - a Watch of the Title by the Voter after their Downvote withdraws it.
- Once the Title is queued, its Downvotes are frozen. A later Watch by a downvoter is shown to the Owner but withdraws nothing.

### Keep

- Clears all of the Title's Downvotes, so it starts again from zero.
- Removes the Title from the Review Queue.

### Remove and Leaving Soon

- A Removed Title goes to Leaving Soon for the Leaving Soon length, never straight to deletion.
- During Leaving Soon the Title stays visible to everyone: in a pinned "Leaving Soon" collection in Plex that Media Review keeps in sync, on the web app, and as a Discord announcement.
- When Leaving Soon ends with no successful Objection, Media Review deletes the Title through Radarr (movie) or Sonarr (show), including its files. It also removes the Title from the Leaving Soon collection.

### Objection

- Any Voter can make an Objection while a Title is Leaving Soon. One per Voter per Title.
- Objections carry Vote Weight. When their total reaches the Objection bar, the Title leaves Leaving Soon and goes back to the Review Queue. The Owner is messaged on Discord.
- A Title can be sent back this way only once. If the Owner Removes it again, its second Leaving Soon allows no Objections.

### Re-requests after deletion

- If anyone requests a deleted Title again, the request goes to the Owner with the Title's history, instead of being approved automatically.
- The preferred mechanism is Seerr holding back the request. If Seerr can't do that, the Title is blocked in Radarr/Sonarr (for example with an import-list exclusion) so the request lands with the Owner. See open question Q1.

### Problem Reports

- A Voter reports that a specific copy of a Title is broken or poor quality and asks for it to be replaced. A Problem Report never counts as a Downvote (ADR 0001).
- It waits for the Owner, who resolves or closes it from Media Ops.
- The reporter is told when it is resolved or closed: in the web app, and on Discord if linked. A resolved one is also announced.

## Settings

All of these are editable by the Owner. Defaults:

| Setting | Default |
|---|---|
| Sample, movies | 30 minutes, cumulative across sessions (any Watch also counts) |
| Sample, TV and anime | 10 minutes, cumulative across episodes and sessions (any Watch also counts) |
| Minimum Audience | 3 Voters |
| Downvote share to reach the queue | 50% of the Audience's Vote Weight |
| Base Weight window | last 90 days of watching |
| Base Weight range | 0 (inactive) to 1 (heavy user) |
| Title Bonus | +2 for a Voter who has Sampled the Title |
| Objection bar | 2 weight (fixed, independent of Audience) |
| Leaving Soon length | 14 days |

Changing a setting re-runs the threshold check for every Title that isn't queued. It never takes a Title out of the queue.

## Open questions

Each one is assigned to the ticket that has to answer it.

- **Q1. Seerr hold-back.** Can Seerr hold back an auto-approved request for a previously Removed Title so it goes to the Owner? Fallback: block it in Radarr/Sonarr. Ticket 0008.
- **Q2. Anime vs TV.** How to tell them apart for the Sample length: a separate Sonarr instance, the series type, or the Plex library. The two defaults are equal (10 minutes), so this doesn't block anything until the Owner sets them apart. Ticket 0011.
- **Q3. Tautulli play duration.** What Tautulli's API exposes for per-user, per-title play duration, which Sample and Base Weight depend on. Ticket 0001.
- **Q4. Base Weight curve.** How watching maps onto 0–1. Proposal: the Voter's watch time in the window divided by the heaviest Voter's watch time in the window. Confirm with the Owner in ticket 0001.
- **Q5. Downvotes from outside the Audience.** The threshold counts the weight of Audience members' Downvotes ("enough of its Audience's weight is behind Downvotes"). A Voter who hasn't Sampled the Title can still cast a Downvote. It is kept and counts as soon as they Sample the Title. Confirm with the Owner in ticket 0001.

## Out of scope

- Any downvote rule or user identity in Media Ops.
- Using Seerr Issues for Problem Reports (ADR 0001).
- Downvoting single episodes or seasons. A Title is a whole show.
- Media Review replacing or fixing a reported copy itself. The Owner does that in Sonarr/Radarr.
