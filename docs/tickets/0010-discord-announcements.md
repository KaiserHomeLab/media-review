# 0010: Discord announcements and Owner messages

**Status:** Done.

**Blocked by:** 0009, 0004, 0006, 0007

## What to build

- Channel announcements: a Title entering Leaving Soon (with its end date), and a resolved Problem Report.
- Direct messages to the reporter when their Problem Report is resolved or closed, if they're linked.
- Messages to the Owner: a Title entering the Review Queue, and an Objection sending a Title back.
- The Owner picks the announcement channel in settings.

## Acceptance criteria

- [x] Each event above sends exactly one message, also when a sync or job runs again.
- [x] Announcements never name who Downvoted or objected.
- [x] Discord being down doesn't block the decision or rule that triggered the message.

## Decided with the Owner

- The Owner's messages go to a private channel picked in Settings. They're not DMs.
- The Owner also hears about new Problem Reports, asks to bring back, failed deletions, and apps unreachable for an hour.
- The announcement channel also gets the last-day reminder, sent back or kept after all, and brought back.
- Announcements are embeds with the poster.
