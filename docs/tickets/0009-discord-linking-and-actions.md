# 0009: Discord account linking and bot actions

**Blocked by:** 0001. Objections need 0006 and Problem Reports need 0007. Add each command once its ticket is done.

## What to build

- On the web app, a signed-in Voter links their Discord account once.
- Bot commands for a linked account: Downvote, withdraw a Downvote, Objection and Problem Report. They use the same rules as the web app.
- An unlinked Discord user who tries any command gets a prompt with a link to connect their account in the web app. Nothing is recorded.

## Acceptance criteria

- [ ] A Downvote cast in Discord counts the same as one cast on the web, including the one-per-Title limit.
- [ ] Unlinked users get the link prompt and nothing is stored.
- [ ] A Voter can unlink and re-link.
- [ ] Bot replies show only the Voter's own Downvotes and Objections.
