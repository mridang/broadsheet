# Broadsheet

Broadsheet: a personalised daily newspaper that turns web feeds into a print-style front page, generated fresh every day. A Next.js app on Cloudflare Workers backed by D1.

- Logged-out visitors get a public Hacker News edition.
- Logged-in users (Google sign-in) get a personalised paper from feeds they add and remove.
- Every feed is fetched, scraped and rebuilt once a day by a Cron Trigger.
- The layout is generative: each story's weight (recency, image, length) decides its tier (lead, feature, standard, with a weak tail collapsed into an "In brief" list), and the excerpt is copyfit to that tier's budget: a lead spans its desk with a large photo, a feature is a card and a standard story a row. Light and dark follow the device.

## Stack

- Next.js (App Router) on Cloudflare Workers via OpenNext
- D1 (SQLite) with Drizzle for users, feeds and articles
- Workers AI to resolve clean publisher and author names from the domain and title
- devbox pins Node 24
- Jest for unit tests, Cypress for end-to-end tests
- `@mridang/eslint-defaults` for linting

## Routes

| Route                           | What                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `/`                             | The front page: the Hacker News edition, or the signed-in user's paper                           |
| `/feeds`                        | Manage feeds (signed in)                                                                         |
| `/login`                        | The sign-in page: one "Sign in with Google" button                                               |
| `/auth/login`, `/auth/callback` | Google sign-in (identity only: `openid email profile`)                                           |
| `/api/sessions/self`            | `DELETE` signs out                                                                               |
| `/api/sessions`                 | `DELETE` signs out everywhere (ends every session of the signed-in person)                       |
| `/api/feeds`, `/api/feeds/{id}` | `POST` follows a feed (201 + `Location`), `DELETE` unfollows one (signed in)                     |
| `/api/feeds/refreshes`          | `POST` re-fetches the signed-in user's feeds and answers how many were refreshed                 |
| `/webhooks/sources/{id}`        | A WebSub hub verifies a subscription (`GET`) and pushes new content (`POST`); signed, plain text |
| `/events/articles/{id}/answers` | `POST` answers a question about an article as server-sent events (signed in)                     |
| `/mcp`                          | MCP server for assistants: feeds, sections, paper, briefing, search, reads, saves, training, ask |
| `/oauth/*`                      | OAuth 2.1 for `/mcp`: register, authorize (Google sign-in, then approve), token, revoke          |
| `/.well-known/oauth-*`          | Discovery documents that point an assistant at the OAuth endpoints                               |
| `/health`                       | Plain `ok`                                                                                       |
| `/img`                          | Image proxy: scales and caches remote pictures (`?url=&w=&sig=`), signed addresses only          |
| `/csp/reports`                  | Receives Content Security Policy violation reports                                               |

The REST API under `/api` is described by `openapi.json` at the root of the repository. Everything that is not REST (sign-in, OAuth, MCP, webhooks, events, the image proxy, feeds out, health) sits outside `/api` and is not in it. `/api/sources/{id}/pushes` is the old WebSub callback, kept only for hubs that subscribed before it moved to `/webhooks/sources/{id}`.

The security headers and the nonce-based Content Security Policy are added by the Worker itself (`src/lib/http`), not by Next.js.

## Testing the API with Schemathesis

`openapi.json` is the whole contract, and `test/openapi.test.ts` fails when it and the controllers drift apart. To fuzz a running instance (local, or deployed) as an ordinary signed-in person:

1. Sign in with Google in a browser, then copy the value of the `broadsheet_session` cookie from the browser's developer tools into an environment variable of your shell, for example `BROADSHEET_SESSION`. Do not paste it anywhere else.
2. Run it against the spec:

```sh
schemathesis run openapi.json --url http://localhost:3737 \
  --header "Cookie: broadsheet_session=$BROADSHEET_SESSION"
```

The cookie is the only credential the API accepts, and any signed-in person can call every operation with it. Two operations also need the curator capability (`PATCH /api/feeds/recommendations/{id}` and listing `pending` or `declined` recommendations): the operator grants it to the test account by adding its email to the `CURATOR_EMAILS` variable, and without it they answer the documented `403`. Schemathesis sends no `Origin` or `Sec-Fetch-Site` header, so the cross-site check lets its writes through. Every write acts on the test account's own data, so use an account made for the purpose.

## Local development

All commands go through devbox, which pins Node 24:

```sh
devbox run -- npm run migrate      # apply D1 migrations to the local database
devbox run -- npm run dev          # next dev on http://localhost:3737
devbox run -- npm test             # jest
devbox run -- npm run lint         # eslint
devbox run -- npm run typecheck    # tsc --noEmit
devbox run -- npm run format       # prettier
```

Local-only settings live in `.env` (gitignored):

```
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
SESSION_SECRET=...
```

Signing in is the same code as in chowdown (`src/lib/auth`, the `/auth` and `/api/sessions` routes). There is no dev login and no fallback secret: when any of the three settings is missing, `/auth/login` answers 503 naming what is missing, and nobody can be signed in. The public Hacker News edition needs none of them. Register `http://localhost:3737/auth/callback` as an authorised redirect URI of the Google OAuth client to sign in locally.

## Deploy

```sh
# one-time per environment
devbox run -- npx wrangler d1 create broadsheet-db       # paste the id into wrangler.jsonc
devbox run -- npx wrangler d1 migrations apply DB --remote
devbox run -- npx wrangler secret put SESSION_SECRET     # HMAC key for session cookies
devbox run -- npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID
devbox run -- npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET

# every release
devbox run -- npm run deploy                             # opennextjs-cloudflare build && wrangler deploy
```

The custom domain `broadsheet.apps.mrida.ng` requires the `apps.mrida.ng` zone on the Cloudflare account, and the Worker needs the AI binding (declared in `wrangler.jsonc`). Register `https://broadsheet.apps.mrida.ng/auth/callback` as the Google OAuth redirect URI. The redirect address is built from the address the request came to; set `APP_URL` only to override it.

Without the three secrets the site still works: it serves the public Hacker News edition, and signing in is refused.

GitHub Actions (`deploy.yml`) applies the D1 migrations and deploys on pushes to `master`.

## Operations

A cron every five minutes (`*/5 * * * *`) fires `scheduled()` in `src/worker.ts`, which starts the `DailyScrape` Workflow. Each run fetches the feeds that are due: a feed is scheduled from how often it publishes and how many people follow it, fetched conditionally with its ETag and Last-Modified, and backed off while it keeps failing. The 06:00 UTC run also backfills the last seven days of the Hacker News feeds from historical data (Algolia), so the first run fills the past week and later runs add the new day, and lays out each reader's issue. There is no public scrape endpoint; signed-in users can refresh their own feeds with `POST /api/feeds/refreshes`.
