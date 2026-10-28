# 0002: Withdraw a Downvote, and freeze Downvotes once queued

**Blocked by:** 0001

**Status:** Done. Media Ops shows the Watches in the same PR as 0003's Keep button.

## What to build

- A Voter can withdraw their own Downvote from the web app until the Title reaches the Review Queue.
- A Watch of the Title by the Voter after their Downvote withdraws it. This is picked up in the Tautulli sync.
- Once a Title is queued its Downvotes are frozen. A later Watch by a downvoter withdraws nothing and is added to the Review Queue entry for the Owner.

## Acceptance criteria

- [x] Withdrawing re-runs the threshold check.
- [x] Withdrawing is refused once the Title is queued.
- [x] A Watch after the Downvote withdraws it before queuing.
- [x] A Sample that isn't a Watch does not withdraw it.
- [x] A Watch before the Downvote does not withdraw it.
- [x] After queuing, a downvoter's Watch shows on the Media Ops card, and the Downvote count is unchanged.
