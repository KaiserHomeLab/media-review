# 0008: Hold back re-requests for deleted Titles

**Blocked by:** 0005

## What to build

If anyone requests a deleted Title again, the request goes to the Owner with the Title's history instead of being approved automatically.

- First answer **Q1**: can Seerr hold back an auto-approved request for a specific Title? Write the answer into the spec.
- If yes, use Seerr. If no, block the Title in Radarr/Sonarr (for example with an import-list exclusion) so the request lands with the Owner.
- Show the Owner the Title's history (Downvotes, Keep/Remove decisions, Objections) where they decide the request, or link to it.

## Acceptance criteria

- [ ] A re-request for a deleted Title is not auto-approved, even for a user whose requests normally are.
- [ ] The Owner can see the Title's history when deciding.
- [ ] Titles that were never Removed are requested as before.
