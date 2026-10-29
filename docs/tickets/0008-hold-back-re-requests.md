# 0008: Hold back re-requests for deleted Titles

**Blocked by:** 0005

**Status:** Done. Q1 is answered in the spec: Seerr can't hold back one Title, so deleted Titles go on Seerr's blocklist and friends ask in Media Review.

## What to build

If anyone requests a deleted Title again, the request goes to the Owner with the Title's history instead of being approved automatically.

- First answer **Q1**: can Seerr hold back an auto-approved request for a specific Title? Write the answer into the spec.
- If yes, use Seerr. If no, block the Title in Radarr/Sonarr (for example with an import-list exclusion) so the request lands with the Owner.
- Show the Owner the Title's history (Downvotes, Keep/Remove decisions, Objections) where they decide the request, or link to it.

## Acceptance criteria

- [x] A re-request for a deleted Title is not auto-approved, even for a user whose requests normally are.
- [x] The Owner can see the Title's history when deciding.
- [x] Titles that were never Removed are requested as before.

## Decided with the Owner

- Seerr blocklist, and friends ask in Media Review under a Gone tab.
- Bring back takes it off the blocklist and requests it in Seerr, approved.
- Held back until the Owner brings it back. No time limit.
- Decline is allowed, with an optional note the friends see.
