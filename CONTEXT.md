# Plex Downvotes

A way for people who use the Plex server to signal that a title is no longer wanted, so the owner can decide whether to remove it.

## Systems

**Media Review**:
The app that holds every Downvote, Objection and Problem Report, applies the rules, keeps the Review Queue and carries out each Keep and Remove.
_Avoid_: Voting app, vote server, downvote bot

**Media Ops**:
The Owner's own dashboard, where the Owner sees the Review Queue and makes decisions. It holds none of the rules.
_Avoid_: Dashboard, ops app

## Language

**Title**:
A whole movie or a whole show: the thing a Downvote is cast against.
_Avoid_: Item, media, entry

**Downvote**:
One user's signal that they think a title should leave the library. A downvote never removes anything by itself, never expires on a timer, and is withdrawn if the Voter has a Watch of the Title afterwards. A Voter can also withdraw their own Downvote until the Title reaches the Review Queue. A Downvote on a Title the Voter hasn't Sampled is kept, but only counts once they Sample it, and they're told so. Once a Title is queued its Downvotes are frozen: a later Watch by a downvoter is shown to the Owner but withdraws nothing.
_Avoid_: Delete vote, removal request

**Watch**:
A play the server counts as finished: a whole movie, or one full episode of a show. Partial or accidental plays are not Watches.
_Avoid_: Play, view, rewatch

**Sample**:
A play of a Title long enough to count as a real try, finished or not. A movie needs more time than a show to count, and anime can have its own length; time adds up across all of a Title's episodes and sessions. Every Watch is also a Sample; accidental plays are neither.
_Avoid_: Partial watch, tried, started

**Voter**:
Anyone the server is shared with. Each Voter can cast at most one Downvote per Title.
_Avoid_: Member, user, viewer

**Vote Weight**:
How much one Voter's Downvote counts toward sending a Title to the Review Queue: their Base Weight plus any Title Bonus.
_Avoid_: Vote power, multiplier

**Base Weight**:
The part of a Voter's Vote Weight earned from how much they have watched on the server recently, regardless of Title.
_Avoid_: Activity score, rank

**Title Bonus**:
The extra Vote Weight a Voter earns on a Title they have Sampled. It is the larger part of a vote.
_Avoid_: Viewer bonus, engagement score

**Audience**:
The Voters who have Sampled a given Title. A Title reaches the Review Queue when enough of its Audience's weight is behind Downvotes.
_Avoid_: Viewers, watchers, fans

**Minimum Audience**:
The smallest Audience a Title must have before it can reach the Review Queue. Titles below it are never flagged, but Downvotes cast on them are kept and count once the Audience reaches the minimum.
_Avoid_: Quorum, minimum viewers

**Review Queue**:
The set of titles whose downvotes have crossed the threshold and now wait for the owner's decision.
_Avoid_: Delete list, kill list

**Problem Report**:
One user's report that a specific copy of a Title is broken or poor quality, asking for it to be replaced. A Problem Report never counts as a Downvote. It waits for the Owner, and the reporter is told when it is resolved or closed.
_Avoid_: File vote, bad-file downvote, complaint

**Keep**:
The Owner's decision to leave a Title in the library after review. A Keep clears all of the Title's Downvotes, so it starts again from zero.
_Avoid_: Approve, reject, dismiss

**Remove**:
The Owner's decision to take a Title out of the library after review. A Removed Title goes to Leaving Soon first, never straight to deletion. If anyone asks for it again after deletion, the request goes to the Owner with the Title's history instead of being approved automatically.
_Avoid_: Delete, purge, cull

**Leaving Soon**:
The grace period a Removed Title spends visible to everyone, inside Plex itself as well as through announcements, before it is deleted, so anyone can finish it.
_Avoid_: Pending deletion, death row, last chance

**Objection**:
A Voter's explicit request, made while a Title is Leaving Soon, to send it back to the Owner for another look. Objections carry Vote Weight and must reach a small fixed amount, independent of the Audience, before the Title goes back. A Title can be sent back this way only once: if the Owner Removes it again, its second Leaving Soon allows no Objections.
_Avoid_: Save, appeal, veto, upvote

**Owner**:
The person who runs the server and makes the final keep-or-remove decision on every title in the Review Queue. Only the Owner can see who cast each Downvote and Objection; Voters see only their own.
_Avoid_: Admin, moderator
