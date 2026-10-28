# Handoff: build Media Review

Media Review is a new, separate app for the Owner's Plex server. Friends downvote titles, a weighted threshold sends them to a Review Queue, and the Owner decides Keep or Remove from their own dashboard, Media Ops (https://github.com/KaiserHomeLab/media-ops). The design is settled. The next session turns it into a spec and tickets, then builds.

## Read first

- `CONTEXT.md`: the glossary. Use its terms exactly (Downvote, Voter, Audience, Sample, Watch, Leaving Soon, Objection, Keep, Remove, Problem Report and the rest). Its rules are the domain behaviour.
- `docs/adr/0001-own-problem-reports-not-seerr-issues.md`
- `docs/adr/0002-rules-live-in-media-review.md`

## Decisions not captured in those files

**Environment.** Everything runs as Docker containers on an Unraid server: Plex, Sonarr, Radarr, Tautulli and Seerr (the merged Overseerr/Jellyseerr). The Owner also runs a Discord server their friends use.

**Media Review's interfaces.**
- A web app with "Sign in with Plex". Plex identity is the Voter identity.
- A Discord bot that can take votes, Objections and Problem Reports from accounts linked once to a Plex sign-in in the web app. It also posts announcements, such as a title entering Leaving Soon or a resolved Problem Report.
- An API that Media Ops uses.

**Leaving Soon** appears as a pinned "Leaving Soon" collection in Plex, kept in sync by Media Review, as well as on the web and in Discord.

**Media Ops integration.** Media Review is added under Settings → Add app, with an address and an API key, like Sonarr or Tautulli. Media Ops shows Review Queue and Problem Report cards and sends Keep, Remove and resolve decisions back. Media Ops is a public project, so the integration must stay optional and hold no downvote rules.

**Starting defaults.** All of these are editable by the Owner.

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

**Assumed but not explicitly confirmed by the Owner.** Confirm these when writing the spec.
- An unlinked Discord user who tries to act gets a prompt to link their account.
- The Owner is notified on Discord when a title enters the Review Queue or an Objection sends one back.

## Open questions to resolve during the build

- Can Seerr hold back an auto-approved request for a previously Removed Title so it goes to the Owner? If not, the fallback is to block the title in Radarr/Sonarr (for example with an import-list exclusion) so the request lands with the Owner.
- How to tell anime from TV for the Sample length. Likely from a separate Sonarr instance or series type, or from the Plex library. Check the Owner's setup.
- What Tautulli's API exposes for per-user, per-title play duration, which the Sample and Base Weight rules depend on.

## Suggested first slice

The smallest end-to-end path: a Voter signs in with Plex, downvotes a Title, and once the threshold is met the Title shows on a Media Ops Review Queue card.

## Suggested skills

- `setup-matt-pocock-skills`: once, in the new Media Review repo, to set up its issue tracker and doc layout.
- `to-spec`: turn this handoff and CONTEXT.md into a spec.
- `to-tickets`: break the spec into tracer-bullet tickets, starting with the first slice above.
- `implement` with `tdd`: build ticket by ticket, test-first. The threshold and weighting rules suit unit tests well.
- `domain-modeling`: keep CONTEXT.md and the ADRs current as anything changes.
- `homelab-docker-ops`: when packaging and deploying the container on Unraid.
