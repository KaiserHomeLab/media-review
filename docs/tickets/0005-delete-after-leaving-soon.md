# 0005: Delete a Title when Leaving Soon ends

**Blocked by:** 0004

**Status:** Built and tested against fake Radarr and Sonarr. The Objection part waits for 0006: a Title sent back is no longer Leaving Soon, so it can't be deleted. To check against the real apps in 0012.

## What to build

- A scheduled job that finds Titles whose Leaving Soon has ended without being sent back.
- For each one: delete it through Radarr (movie) or Sonarr (show), including files, and take it out of the Leaving Soon collection. Mark it deleted, keeping its history.
- There are two Sonarr instances: one for TV and one for anime. Delete each show through the one that has it.
- Find Titles in Radarr/Sonarr by their TMDB/TVDB id from Plex, and delete every copy found, with an import-list exclusion.
- Overnight: Leaving Soon ends at the first 04:00 after 14 days; deletions run 04:00–07:00 only.
- Not in Radarr or Sonarr: don't delete; stay Leaving Soon, and tell the Owner.

## Acceptance criteria

- [ ] A Title deletes no earlier than its end date.
- [ ] An anime show is deleted through the Sonarr that has it (found by TVDB id), so anime goes through the anime Sonarr and TV through the TV one.
- [ ] A Title sent back by Objections (0006) is not deleted.
- [ ] A Sonarr or Radarr failure leaves the Title in Leaving Soon, is retried, and is visible to the Owner. A Title is never marked deleted when it isn't.
- [ ] Running the job twice does nothing extra.
- [ ] Nothing is deleted outside 04:00–07:00, and the end date friends see is the night it goes.
- [ ] A Title in neither Radarr nor Sonarr stays, with the reason shown to the Owner.
