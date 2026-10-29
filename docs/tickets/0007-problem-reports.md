# 0007: Problem Reports

**Blocked by:** 0001

**Status:** Done. Discord notices come with 0010.

## What to build

Problem Reports built into Media Review, not Seerr Issues (ADR 0001).

- On the web app, a Voter files a Problem Report on a Title: a specific copy is broken or poor quality, with a description.
- API: list open Problem Reports, and resolve or close one.
- Media Review: open Problem Reports with resolve and close on the Owner's pages (ADR 0003).
- Media Ops: a Problem Report card with resolve and close. This is a Media Ops PR.
- The reporter sees the outcome in the web app. Discord notice comes in 0010.

## Acceptance criteria

- [x] A Problem Report never counts as a Downvote or affects the threshold.
- [x] Resolved and closed reports leave the open list, and the reporter sees which happened.
- [x] Voters see only their own Problem Reports.

## Decided with the Owner

- A show's report can be on the whole show, a season, or one episode.
- Reasons to pick from (Won't play, Video, Audio, Subtitles, Wrong title or language, Poor quality, Other), with an optional note. Other needs one.
- Resolve and Close take an optional note the reporters see.
- The same problem again joins the open report as a "me too"; everyone on it sees the outcome.
