# Security

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use GitHub's private reporting
instead: **Security → Report a vulnerability** on this repository. I'll reply there as soon as I
can.

## How Media Review handles your secrets and your friends

- **API keys and tokens** (Tautulli, Radarr, Sonarr, Seerr, the Plex token and the Discord bot
  token) are stored in the database in `/config`, and are never sent back to the browser. The
  Settings page only shows that one is saved.
- **Claiming the install.** Until first setup is done, nobody can sign in. Setup needs a one-time
  code printed in the container's log, so only someone with access to the server can claim it.
  Ten wrong codes close setup until the container restarts with a new code.
- **Who can sign in.** Sign-in is Plex's own. The account that owns the linked Plex server is the
  Owner; accounts the server is shared with are Voters; anyone else is turned away.
- **Sessions** are a random token in an HttpOnly, SameSite=Lax cookie (Secure behind https),
  valid for 30 days. Every request that changes something must send JSON, which a form on
  another website can't, so other sites can't act on your behalf.
- **The Owner's pages and API** (Review Queue, Settings, decisions) refuse Voters. The API for
  Media Ops needs the key generated under Settings, compared in constant time.
- **What Voters see.** Only their own Downvotes, Objections, Problem Reports and asks. Who
  Downvoted or objected is shown to the Owner only. Discord announcements never name anyone, and
  the bot's replies are visible only to the person who used the command.
- **Linking Discord** uses a one-time link from the bot, valid for 30 minutes, opened while signed
  in with Plex.
- **Posters** are fetched by the server, so the Plex token never reaches the browser. Posters in
  Discord announcements use a signed link that only works for that one title.
- **Every page** is sent with a strict Content Security Policy (our own scripts only, no
  framing), and `nosniff`.
- **Deleting** only ever happens to a title the Owner Removed, after its Leaving Soon ran out.
- **The log** never contains API keys or tokens.
