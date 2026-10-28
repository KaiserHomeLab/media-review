# 0002: Withdraw a Downvote, and freeze Downvotes once queued

**Blocked by:** 0001

## What to build

- A Voter can withdraw their own Downvote from the web app until the Title reaches the Review Queue.
- A Watch of the Title by the Voter after their Downvote withdraws it. This is picked up in the Tautulli sync.
- Once a Title is queued its Downvotes are frozen. A later Watch by a downvoter withdraws nothing and is added to the Review Queue entry for the Owner.

## Acceptance criteria

- [ ] Withdrawing re-runs the threshold check.
- [ ] Withdrawing is refused once the Title is queued.
- [ ] A Watch after the Downvote withdraws it before queuing.
- [ ] A Sample that isn't a Watch does not withdraw it.
- [ ] A Watch before the Downvote does not withdraw it.
- [ ] After queuing, a downvoter's Watch shows on the Media Ops card, and the Downvote count is unchanged.
