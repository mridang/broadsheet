# broadsheet

The Hacker Times: a personalised daily newspaper that turns web feeds into a print-style front page, generated fresh every day. A Next.js app on Cloudflare Workers backed by D1.

- Logged-out visitors get a public Hacker News edition.
- Logged-in users (Google sign-in) get a personalised paper from feeds they add and remove.
- Every feed is fetched, scraped and rebuilt once a day by a Cron Trigger.
- The layout is generative: each story's weight (recency, image, length) decides its tier (lead, feature, standard, with a weak tail collapsed into an "In Brief" rail), the excerpt is copyfit to that tier's budget, and lead and feature photos float so the copy wraps around them. There are FT and Economist themes with a dynamic address-bar `theme-color`.

## Stack

- Next.js (App Router) on Cloudflare Workers via OpenNext
- D1 (SQLite) with Drizzle for users, feeds and articles
- Workers AI to resolve clean publisher and author names from the domain and title
- devbox pins Node 24
- Jest for unit tests, Cypress for end-to-end tests
- `@mridang/eslint-defaults` for linting

## Routes

| Route                                   | What                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `/`                                     | The front page: the Hacker News edition, or the signed-in user's paper                  |
| `/feeds`                                | Manage feeds (signed in)                                                                |
| `/login`                                | The sign-in page: one "Sign in with Google" button                                      |
| `/api/auth/login`, `/api/auth/callback` | Google sign-in (identity only: `openid email profile`)                                  |
| `/api/sessions/self`                    | `DELETE` signs out                                                                      |
| `/api/sessions`                         | `DELETE` signs out everywhere (ends every session of the signed-in person)              |
| `/api/feeds`, `/api/feeds/{id}`         | `POST` follows a feed (201 + `Location`), `GET`/`DELETE` one feed (signed in)           |
| `/api/feed-refreshes`                   | `POST` re-fetches the signed-in user's feeds and answers how many were refreshed        |
| `/api/health`                           | Plain `ok`                                                                              |
| `/api/img`                              | Image proxy: scales and caches remote pictures (`?url=&w=&sig=`), signed addresses only |
| `/api/csp-reports`                      | Receives Content Security Policy violation reports                                      |

The security headers and the nonce-based Content Security Policy are added by the Worker itself (`src/lib/http`), not by Next.js.

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

Signing in is the same code as in chowdown (`src/lib/auth`, the `/api/auth` and `/api/sessions` routes). There is no dev login and no fallback secret: when any of the three settings is missing, `/api/auth/login` answers 503 naming what is missing, and nobody can be signed in. The public Hacker News edition needs none of them. Register `http://localhost:3737/api/auth/callback` as an authorised redirect URI of the Google OAuth client to sign in locally.

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

The custom domain `broadsheet.apps.mrida.ng` requires the `apps.mrida.ng` zone on the Cloudflare account, and the Worker needs the AI binding (declared in `wrangler.jsonc`). Register `https://broadsheet.apps.mrida.ng/api/auth/callback` as the Google OAuth redirect URI. The redirect address is built from the address the request came to; set `APP_URL` only to override it.

Without the three secrets the site still works: it serves the public Hacker News edition, and signing in is refused.

GitHub Actions (`deploy.yml`) applies the D1 migrations and deploys on pushes to `master`.

## Operations

A single cron (`0 6 * * *`, 06:00 UTC) fires `scheduled()` in `src/worker.ts`. It refreshes every feed, then backfills the last seven days of the Hacker News feeds from historical data (Algolia), so the first run fills the past week and later runs add the new day. There is no public scrape endpoint; signed-in users can refresh their own feeds from `/api/refresh`.
