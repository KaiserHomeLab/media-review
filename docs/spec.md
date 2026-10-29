# Media Review: spec

Media Review lets the people the Owner's Plex server is shared with signal that a Title is no longer wanted. A weighted threshold sends a Title to the Review Queue, and the Owner decides Keep or Remove, in Media Review itself or, if they use it, in Media Ops. Media Review holds every rule and carries out every decision (ADR 0002). It works fully without Media Ops (ADR 0003).

Terms are used exactly as defined in [CONTEXT.md](../CONTEXT.md). Where this spec and CONTEXT.md disagree, CONTEXT.md wins and this spec is fixed.

## Environment

- Runs as one Docker container on the Owner's Unraid server, next to Plex, Sonarr, Radarr, Tautulli and Seerr: `ghcr.io/kaiserhomelab/media-review`, published by CI and installed with an Unraid template. It sits on the Owner's custom Docker network and reaches the other apps by container name.
- Friends reach the web app from the internet through the Owner's Cloudflare Tunnel.
- Anime has its own Plex library and its own Sonarr instance, separate from TV.
- Holds its own keys for Plex, Tautulli, Sonarr, Radarr, Seerr and Discord (ADR 0002, Consequences).
- Works with or without Media Ops. If Media Ops is down or not installed, the Owner decides in Media Review's own web app.

## Interfaces

### Web app

- "Sign in with Plex". The Plex account is the Voter identity. Only accounts the server is shared with, plus the Owner, can sign in.
- The Owner is the Plex server's owner account.
- Voters can browse Titles, cast and withdraw a Downvote, see Leaving Soon, make an Objection, file a Problem Report, and link a Discord account.
- Voters see only their own Downvotes and Objections. Only the Owner can see who cast each one.
- The Owner has a **Review Queue** page with every entry and its details (the same as the Media Ops card) and the decisions: Keep now, Remove (0004) and Problem Reports (0007) later.
- **First setup** (confirmed by the Owner): a fresh install has no Owner. It prints a one-time setup code in its log, and the setup page asks for it before anything else. Then the Owner signs in with the Plex account that owns the server and picks the server and the address to reach it. Media Review keeps that sign-in's token for Plex. The account that owns the linked server is the Owner from then on.
- **Settings page** (Owner only; confirmed by the Owner): the apps Media Review works with, each with an address, an API key, **Test** and **Save**.
  - The apps are Plex (address), Tautulli, Radarr, Sonarr, Sonarr (anime) and Seerr.
  - The page also has the public address, and the API key for Media Ops, which is only needed if Media Ops is used.
  - Everything is kept in the database in `/config`, not in container variables. Saved keys and the Plex token are never sent back to the browser, and changes apply without a restart.
  - The rules in [Settings](#settings) get a section here next (ticket 0011).

### Discord bot

- A Discord account is linked once to a Plex sign-in, from the web app.
- Linked accounts can Downvote, make an Objection and file a Problem Report from Discord.
- An unlinked Discord user who tries any of those gets a prompt with a link to connect their account in the web app. Nothing is recorded.
- **Confirmed by the Owner (0009):**
  - **Linking:** any command from an unlinked account replies with a one-time link, valid for 30 minutes, to `link.html`. There the person signs in with Plex if they need to and presses Connect. `/link` gives a fresh link. Linking again replaces the old link, on either side. The web app shows "connected as …" with Disconnect, and `/unlink` does the same.
  - **Commands:** `/downvote`, `/withdraw` (a Downvote or an Objection), `/object`, `/report` (problem, optional part: whole show, a season or an episode, and an optional note), `/mine`, `/link` and `/unlink`. Titles autocomplete: `/object` offers only what's Leaving Soon, and `/withdraw` offers only the person's own Downvotes and Objections. The commands run through the same rules as the web app. The Owner can link, but the Owner doesn't Downvote, object or report.
  - **Replies:** private to the person who used the command (ephemeral). A command that takes over about 2.5 seconds is answered "thinking…" first, then edited.
  - **Connection:** the bot connects out to Discord's gateway, so no public address is needed for commands. The one-time link does use the public address. Commands are registered in, and answered in, only the server picked in Settings.
  - **Setup:** Settings → + Add app → Discord. Paste the bot token, press Test to list the servers the bot is in, pick one and Save. The token is never sent back to the browser.
- Announcements to the server channel: a Title entering Leaving Soon, and a resolved Problem Report (the reporter is told directly too).
- Messages to the Owner: a Title entering the Review Queue, and an Objection sending a Title back to the Owner.
- **Confirmed by the Owner (0010):**
  - **The Owner's messages** go to a private channel the Owner picks in Settings, not as DMs. Besides the two above, they cover: a new Problem Report (one per report, not per "me too"), an ask to bring back, a deletion that failed (once per Leaving Soon), and an app unreachable for an hour, plus a message when it's back.
  - **The announcement channel** gets: Leaving Soon, a last-day reminder the day before it's deleted, "not leaving for now" when Objections send it back, "staying after all" after Keep after all, "coming back" when brought back, and a resolved Problem Report. A closed one isn't announced.
  - **Look:** each announcement is a Discord embed with the poster. Discord fetches the poster by a signed link (`/cover/:key/:sig`), so only announced posters can be fetched without signing in.
  - **DMs:** each reporter with a linked Discord gets a DM when their report is resolved or closed, with the Owner's note.
  - **How "exactly once" works:** Media Review records one notice per event, under a key naming the event, then sends what's unsent, oldest first, every minute and after each sync. Running it again records nothing new. If Discord is down the notices wait, and no decision waits on Discord. A DM that can't be delivered is given up after 3 tries.
  - **Starting point:** only events from when the channels are first set are posted, so turning this on doesn't announce the past.
  - **Privacy:** announcements never name who Downvoted or objected. The Owner's channel does.

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
- Base Weight ranges from 0 (no watching in the window) to 1 (heavy user): the Voter's watch time on the whole server over the Base Weight window, divided by the heaviest Voter's.
- Title Bonus applies on a Title the Voter has Sampled.
- Vote Weight is computed when the threshold is checked, not frozen at the moment of the Downvote. Once a Title is queued, its Downvotes are frozen (see below).

### Reaching the Review Queue

A Title is added to the Review Queue when both of these are true:

1. Its Audience is at least the Minimum Audience.
2. The Vote Weight of the Audience members who Downvoted it is at least the Downvote share of the Audience's total Vote Weight.

The check runs whenever a Downvote is cast or withdrawn and whenever new play history changes a Title's Audience or any Vote Weight. Downvotes on a Title below the Minimum Audience are kept and count once the Audience reaches it.

### Downvotes

- One Downvote per Voter per Title. A Title is a whole movie or a whole show.
- A Voter can Downvote a Title they haven't Sampled. It is kept but only counts once they Sample it, and they're told so when they cast it and while it's waiting.
- A Downvote never removes anything by itself and never expires on a timer.
- Before the Title is queued:
  - the Voter can withdraw their own Downvote.
  - a Watch of the Title by the Voter after their Downvote withdraws it.
- Once the Title is queued, its Downvotes are frozen. A later Watch by a downvoter is shown to the Owner but withdraws nothing.
- Confirmed by the Owner:
  - A Watch is one full episode, so finishing any episode of a show after Downvoting it withdraws the Downvote.
  - A Watch only withdraws a Downvote if it started after the Downvote was cast.
  - A Downvote withdrawn by a Watch disappears silently: the Voter isn't messaged.
  - The Owner is shown only finished Watches since queuing, not Samples.

### Keep

- Clears all of the Title's Downvotes, so it starts again from zero.
- Removes the Title from the Review Queue.
- Confirmed by the Owner: there is no cooldown. Voters can Downvote a Kept Title again straight away, and it can return to the Review Queue as soon as it reaches the threshold again. Earlier Keeps show in its history.
- Voters aren't messaged about a Keep. Their Downvote just goes away.

### Remove and Leaving Soon

- A Removed Title goes to Leaving Soon for the Leaving Soon length, never straight to deletion.
- During Leaving Soon the Title stays visible to everyone: in a pinned "Leaving Soon" collection in Plex that Media Review keeps in sync, on the web app, and as a Discord announcement.
  - Plex: one "Leaving Soon" collection in each library that has a Leaving Soon Title, pinned to friends' Home, the Owner's Home and the library's Recommended tab (confirmed by the Owner). A library with none left has its collection deleted, so nothing empty stays pinned.
  - Web app: a Leaving Soon tab in the library, and a "Leaving in N days" label on the Title's tile (confirmed by the Owner).
  - Remove takes no note: friends see the Title and the day it leaves (confirmed by the Owner).
- No new Downvotes are taken on a Title that is Leaving Soon.
- **Keep after all:** the Owner can Keep a Title while it is Leaving Soon, in Media Review or Media Ops (confirmed by the Owner). It is an ordinary Keep: the Title leaves Leaving Soon and the collection, and its Downvotes are cleared.
- When Leaving Soon ends with no successful Objection, Media Review deletes the Title through Radarr (movie) or Sonarr (show), including its files. It also removes the Title from the Leaving Soon collection.
  - The Owner runs one Radarr and two Sonarrs, one for TV and one for anime. A Title is found in them by the IDs Plex has for it (TMDB for movies, TVDB for shows), and every copy found is deleted.
  - Each deletion also adds an import-list exclusion, so lists don't download it again (confirmed by the Owner).
  - Deletion happens overnight: Leaving Soon ends at the first 04:00 (server time) after its length, and deletions run only between 04:00 and 07:00. A night that was missed waits for the next one (confirmed by the Owner).
  - A Title in neither Radarr nor Sonarr is not deleted. It stays Leaving Soon and the Owner is shown why (confirmed by the Owner).
  - A failed deletion leaves the Title Leaving Soon, shows the Owner the error, and is tried again the next night. A Title is marked deleted only once it has been.

### Objection

- Any Voter can make an Objection while a Title is Leaving Soon. One per Voter per Title.
- Objections carry Vote Weight. When their total reaches the Objection bar, the Title leaves Leaving Soon and goes back to the Review Queue. The Owner is messaged on Discord.
- A Title can be sent back this way only once. If the Owner Removes it again, its second Leaving Soon allows no Objections.
- Confirmed by the Owner:
  - An Objection weighs what that Voter's Downvote would (Base Weight, plus the Title Bonus if they've Sampled it). With the bar at 2, one friend who has tried the Title can send it back alone. The bar is editable in Rules.
  - A Voter who Downvoted the Title can't object to it.
  - A Voter can withdraw an Objection until the Title is sent back.
  - "Only once" is per round: a Keep wipes the slate, so a much later Remove allows Objections again.
- Sent back, the Title leaves Leaving Soon and the Plex collection (so it can't be deleted) and returns to the Review Queue marked as sent back, with its Downvotes and who objected. Only the Owner sees who objected.

### Re-requests after deletion

- If anyone requests a deleted Title again, the request goes to the Owner with the Title's history, instead of being approved automatically.
- Seerr can't hold back one Title's request for the Owner (see Q1), so it works like this (confirmed by the Owner, 0008):
  - When Media Review deletes a Title, it adds it to Seerr's blocklist. Nobody can request it there. This is called **held back**, and it lasts until the Owner brings the Title back.
  - Friends see held-back Titles under a **Gone** tab in Media Review, and can **Ask to bring it back**, with an optional note. They see their own asks, and what the Owner decided, for 30 days. They never see who else asked.
  - The Owner sees each held-back Title with who asked and the Title's history: each Remove's Downvotes (with Vote Weight) and Objections, every Keep and Remove, and each deletion. They choose **Bring back** or **Decline**, with an optional note the friends who asked see. The Owner can bring back a Title nobody asked for.
  - **Bring back** takes the Title off Seerr's blocklist and requests it there with the API key, so it is approved and downloads. A show is requested with every season. **Decline** answers the asks and the Title stays held back.
  - If Seerr isn't set up, or Plex has no TMDB id for the Title, it can't be blocked. The Owner sees why, and Media Review tries again after every sync.
  - Titles deleted before this feature existed are held back once, on upgrade.
  - The same decisions are in Media Ops (`/api/v1/held-back`).

### Problem Reports

- A Voter reports that a specific copy of a Title is broken or poor quality and asks for it to be replaced. A Problem Report never counts as a Downvote (ADR 0001).
- It waits for the Owner, who resolves or closes it in Media Review, or in Media Ops if connected.
- The reporter is told when it is resolved or closed: in the web app, and on Discord if linked. A resolved one is also announced.
- **Confirmed by the Owner (0007):**
  - For a show, a report is on the whole show, one season, or one episode, picked from the show's episodes in Plex.
  - The Voter picks a reason: Won't play, Video, Audio, Subtitles, Wrong title or language, Poor quality, or Other. A note is optional, except for Other.
  - The Owner can add an optional note when resolving or closing it, and the reporters see it with the outcome.
  - A second Voter with the same problem (same Title, part and reason) joins the open report ("me too"), with an optional note of their own. Before filing, a Voter sees the open reports on the Title, without names, and can say "me too" to one.
  - A Voter can withdraw from a report while it is open. A report nobody is on any more is gone.
  - Voters see their own open reports and, for 30 days, the outcome of their decided ones.

## Settings

All of these are editable by the Owner. Defaults:

| Setting | Default |
|---|---|
| Sample, movies | 30 minutes, cumulative across sessions (any Watch also counts) |
| Sample, TV | 10 minutes, cumulative across episodes and sessions (any Watch also counts) |
| Sample, anime | 10 minutes, the same way, for shows in the Plex libraries the Owner marks as anime |
| Minimum Audience | 3 Voters |
| Downvote share to reach the queue | 50% of the Audience's Vote Weight |
| Base Weight window | last 90 days of watching |
| Base Weight range | 0 (inactive) to 1 (heavy user) |
| Title Bonus | +2 for a Voter who has Sampled the Title |
| Objection bar | 2 weight (fixed, independent of Audience) |
| Leaving Soon length | 14 days |
| Deletion hour | 04:00 server time; deletions run for three hours from it |

Changing a setting re-runs the threshold check for every Title that isn't queued. It never takes a Title out of the queue. A new Leaving Soon length or deletion hour applies from the next Remove; Titles already Leaving Soon keep their date. The Objection bar is added with Objections (0006).

## Open questions

Each one is assigned to the ticket that has to answer it. Answered ones stay here as the record.

- **Q1. Seerr hold-back.** *Answered in 0008, from Seerr's source code (3.5.1).* No. Auto-approval depends only on the user's permissions (`AUTO_APPROVE`, `AUTO_APPROVE_MOVIE`, `AUTO_APPROVE_TV`, `MANAGE_REQUESTS`, `ADMIN`), and nothing holds back one Title. The nearest thing is the blocklist: `POST /api/v1/blocklist` with `{ tmdbId, mediaType, title, user }` makes a request for that Title fail with "This media is blocklisted", and `DELETE /api/v1/blocklist/:tmdbId?mediaType=` lifts it. So a deleted Title is blocklisted, and the ask goes through Media Review. The Radarr/Sonarr import-list exclusion was not used as the fallback: it is meant for import lists, it wasn't confirmed whether it stops a request from Seerr, and either way the request would fail in Radarr rather than reach the Owner.
- **Q2. Anime vs TV.** *Answered by the Owner.* Anime has its own Plex library and its own Sonarr instance. Media Review tells anime from TV by Plex library, and deletes an anime Title through the anime Sonarr. Tickets 0011 and 0005.
- **Q3. Tautulli play duration.** *Answered in 0001, from Tautulli's API documentation; not yet checked against the Owner's server.* `get_history` with `grouping=0` returns one row per session with `user_id` (the Plex account id), `media_type`, `rating_key` (and `grandparent_rating_key`, the show, for episodes), `play_duration` in seconds with pauses excluded (`duration` before Tautulli 2.13) and `watched_status` (1 when Tautulli counts it as finished: a Watch). Media Review adds these up per Voter per Title. `get_users` lists the Voters: everyone but the admin (the Owner) and the Local user, and only those still active.
- **Q4. Base Weight curve.** *Answered by the Owner:* a Voter's watch time in the window divided by the heaviest Voter's. Built in 0001.
- **Q5. Downvotes from outside the Audience.** *Answered by the Owner:* a Downvote from a Voter who hasn't Sampled the Title is kept and counts once they Sample it, and the Voter is told it won't count until then. Built in 0001.

## Out of scope

- Any downvote rule or user identity in Media Ops.
- Using Seerr Issues for Problem Reports (ADR 0001).
- Downvoting single episodes or seasons. A Title is a whole show.
- Media Review replacing or fixing a reported copy itself. The Owner does that in Sonarr/Radarr.
