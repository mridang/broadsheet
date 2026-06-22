# broadsheet

**The Hacker Times** — a personalised daily newspaper that turns web feeds into a
print-style front page, generated fresh every day. A Cloudflare Worker backed by D1.

- **Logged-out** visitors get a public **Hacker News edition**.
- **Logged-in** users (Google sign-in) get a **personalised paper** from feeds they
  add/remove.
- Every feed is **fetched, scraped and rebuilt once a day** (a Cron Trigger).
- The layout is **generative**: each story's weight (recency + image + length)
  decides its tier (lead / feature / standard, with a weak tail collapsed into an
  "In Brief" rail), the excerpt is **copyfit** to that tier's budget, and lead/feature
  photos **float so the copy wraps around them**. FT / Economist themes with a
  dynamic address-bar `theme-color`.

This is a port of an earlier zero-dependency Node proof-of-concept (`app/` in the
`mridang/scratch` repo) to Cloudflare: `node:http` → the Worker `fetch` handler,
`node:sqlite` → D1, `node:crypto` HMAC → Web Crypto, the Node timer → a Cron Trigger.

## Architecture

- `src/index.ts` — Worker entry: `fetch()` router (pages + form APIs + OAuth) and
  `scheduled()` (daily refresh).
- `src/render.ts` + `src/style.ts` — HTML rendering and the generative layout engine
  (`assignTiers`, copyfit). CSS ported verbatim from the POC.
- `src/scrape.ts` — RSS/Atom parsing + article enrichment (og:image, og/meta
  description, favicon via Google s2) and clean source-name resolution
  (og:site_name + a deterministic domain algorithm; optional LLM if `ANTHROPIC_API_KEY`).
- `src/db.ts` — D1 data layer (users / feeds / articles).
- `src/auth.ts` + `src/session.ts` — Google OAuth and signed-cookie sessions.
- `migrations/` — D1 schema.

## Develop

```bash
npm install
# one-time: create a local D1 and load the schema
npx wrangler d1 migrations apply broadsheet-db --local
npm run dev            # http://localhost:8787

# trigger the daily scrape manually in local dev:
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

Put local-only overrides in `.dev.vars` (gitignored), e.g. `BASE_URL`,
`ALLOW_DEV_LOGIN=1`, `SESSION_SECRET`.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`: typecheck → apply D1 migrations
→ `wrangler deploy`. Live at **https://broadsheet.apps.mrida.ng**.

### Secrets (set with `wrangler secret put …` or in the Cloudflare dashboard)

| Secret                                      | Purpose                                                                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`                            | HMAC key for session cookies (required in production)                                                                                                                |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in. Register `https://broadsheet.apps.mrida.ng/auth/google/callback` as the redirect URI. When unset, the passwordless **dev login** is enabled instead. |
| `ANTHROPIC_API_KEY`                         | Optional — LLM-resolved source names (falls back to a deterministic algorithm).                                                                                      |

Without any secrets the site still works: it serves the public Hacker News edition
and allows dev login.
