# 0006: Objection sends a Title back once

**Blocked by:** 0004

**Status:** Done. Discord messages to the Owner on a send-back come with 0010.

## What to build

- On the web app, a Voter can make an Objection on a Title that is Leaving Soon. One per Voter per Title. Voters see only their own Objections.
- Objections carry Vote Weight. When their total reaches the Objection bar (2), the Title leaves Leaving Soon and the Plex collection and goes back to the Review Queue, marked as sent back.
- A Title can be sent back only once. If it is Removed again, its second Leaving Soon allows no Objections.
- The Owner sees who objected, on the Review Queue entry.

## Acceptance criteria

- [x] Unit tests cover: the bar reached exactly at 2, staying under 2, and the bar not depending on the Audience.
- [x] A sent-back Title is in the queue, out of the collection, and not deleted by 0005.
- [x] On its second Leaving Soon, Objections are refused, and the web app says why.
- [x] Objections on a Title that isn't Leaving Soon are refused.
