# Media Review works on its own; Media Ops is optional

Not everyone who runs Media Review will run Media Ops, or want to. So the Owner sees the Review Queue and makes every decision (Keep, Remove, resolving Problem Reports) in Media Review's own web app. Media Ops is an optional second place to do the same, through Media Review's API. Both places call the same actions in Media Review, so a decision made in one shows in the other, and nothing about the rules depends on which one the Owner uses.

This amends [ADR 0002](0002-rules-live-in-media-review.md). That ADR said Media Ops shows the queue, so the Owner's queue screen was unavailable whenever Media Ops was down.

## Considered Options

- **Media Ops as the only Owner screen.** Less to build, but anyone without Media Ops couldn't decide anything, so Media Review would effectively require it.
- **A setting that hides Media Review's Owner screens when Media Ops is connected.** Rejected: there's no harm in having both, and it would add a setting to explain.
