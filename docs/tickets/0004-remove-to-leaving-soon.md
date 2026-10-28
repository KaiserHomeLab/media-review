# 0004: Remove from Media Ops into Leaving Soon

**Blocked by:** 0001

## What to build

- API: Remove a queued Title.
- Media Ops: a Remove button on the Review Queue card. This is a Media Ops PR.
- Remove moves the Title into Leaving Soon for the Leaving Soon length (14 days) and records it in the Title's history. Nothing is deleted here.
- Media Review keeps a pinned "Leaving Soon" collection in Plex in sync. Titles enter it on Remove and leave it when Leaving Soon ends, whatever the outcome.
- A Leaving Soon page on the web app shows each Title and its end date.

## Acceptance criteria

- [ ] After Remove, the Title is out of the Review Queue, in the Plex collection and on the web page with its end date.
- [ ] The collection is pinned and is recreated if someone deletes it.
- [ ] Remove on a Title that isn't queued is rejected.
