# Tickets

Vertical slices of [the spec](../spec.md), in build order. Each ticket cuts through every layer it needs (data, rules, web/API/Discord, integrations) and ends in something the Owner or a Voter can use. Terms are as defined in [CONTEXT.md](../../CONTEXT.md).

| # | Ticket | Blocked by |
|---|---|---|
| 0001 | [Downvote a Title until it shows on a Media Ops Review Queue card](0001-downvote-to-review-queue.md) | none |
| 0002 | [Withdraw a Downvote, and freeze Downvotes once queued](0002-withdraw-and-freeze.md) | 0001 |
| 0003 | [Keep from Media Ops](0003-keep.md) | 0001 |
| 0004 | [Remove from Media Ops into Leaving Soon](0004-remove-to-leaving-soon.md) | 0001 |
| 0005 | [Delete a Title when Leaving Soon ends](0005-delete-after-leaving-soon.md) | 0004 |
| 0006 | [Objection sends a Title back once](0006-objection.md) | 0004 |
| 0007 | [Problem Reports](0007-problem-reports.md) | 0001 |
| 0008 | [Hold back re-requests for deleted Titles](0008-hold-back-re-requests.md) | 0005 |
| 0009 | [Discord account linking and bot actions](0009-discord-linking-and-actions.md) | 0001 |
| 0010 | [Discord announcements and Owner messages](0010-discord-announcements.md) | 0009, 0004, 0006, 0007 |
| 0011 | [Owner settings](0011-owner-settings.md) | 0001 |
| 0012 | [Package and deploy on Unraid](0012-package-and-deploy.md) | 0001 |

0002, 0003, 0004, 0007, 0009, 0011 and 0012 can be built in parallel once 0001 is done.
