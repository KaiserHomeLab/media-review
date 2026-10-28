# 0010: Discord announcements and Owner messages

**Blocked by:** 0009, 0004, 0006, 0007

## What to build

- Channel announcements: a Title entering Leaving Soon (with its end date), and a resolved Problem Report.
- Direct messages to the reporter when their Problem Report is resolved or closed, if they're linked.
- Messages to the Owner: a Title entering the Review Queue, and an Objection sending a Title back.
- The Owner picks the announcement channel in settings.

## Acceptance criteria

- [ ] Each event above sends exactly one message, also when a sync or job runs again.
- [ ] Announcements never name who Downvoted or objected.
- [ ] Discord being down doesn't block the decision or rule that triggered the message.
