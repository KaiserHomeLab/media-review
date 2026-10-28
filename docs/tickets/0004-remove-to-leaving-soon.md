# 0004: Remove into Leaving Soon

**Blocked by:** 0001

**Status:** Media Review side built. Media Ops buttons in a Media Ops PR. The Plex collection calls follow Plex Web's own API and are tested against a fake Plex; they still need checking against the real server (ticket 0012).

## What to build

- API: Remove a queued Title.
- Media Review: a Remove button on the Owner's Review Queue page (ADR 0003).
- Media Ops: a Remove button on the Review Queue card. This is a Media Ops PR.
- Remove moves the Title into Leaving Soon for the Leaving Soon length (14 days) and records it in the Title's history. Nothing is deleted here.
- Media Review keeps a pinned "Leaving Soon" collection in Plex in sync. Titles enter it on Remove and leave it when Leaving Soon ends, whatever the outcome.
- A Leaving Soon tab on the web app shows each Title and its end date, and each tile says "Leaving in N days".
- Collections live per Plex library (Movies, TV Shows, Anime…), pinned to friends' Home, the Owner's Home and the library's Recommended tab. One is deleted when its library has nothing Leaving Soon.
- **Keep after all:** the Owner Keeps a Leaving Soon Title from Media Review or Media Ops. It's an ordinary Keep.

## Acceptance criteria

- [ ] After Remove, the Title is out of the Review Queue, in the Plex collection and on the web page with its end date.
- [ ] The collection is pinned and is recreated if someone deletes it.
- [ ] Remove on a Title that isn't queued is rejected.
- [ ] Keep after all takes the Title out of Leaving Soon and the collection, and clears its Downvotes.
- [ ] Downvotes on a Leaving Soon Title are refused.
- [ ] Voters see the end date but never who Downvoted.
