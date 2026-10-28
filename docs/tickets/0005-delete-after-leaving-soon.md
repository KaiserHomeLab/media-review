# 0005: Delete a Title when Leaving Soon ends

**Blocked by:** 0004

## What to build

- A scheduled job that finds Titles whose Leaving Soon has ended without being sent back.
- For each one: delete it through Radarr (movie) or Sonarr (show), including files, and take it out of the Leaving Soon collection. Mark it deleted, keeping its history.
- There are two Sonarr instances: one for TV and one for anime. Delete each show through the one that has it.

## Acceptance criteria

- [ ] A Title deletes no earlier than its end date.
- [ ] An anime show is deleted through the anime Sonarr, a TV show through the TV Sonarr.
- [ ] A Title sent back by Objections (0006) is not deleted.
- [ ] A Sonarr or Radarr failure leaves the Title in Leaving Soon, is retried, and is visible to the Owner. A Title is never marked deleted when it isn't.
- [ ] Running the job twice does nothing extra.
