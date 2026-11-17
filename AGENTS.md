<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## Tailwind

Tailwind 4 no longer gives `<button>` the pointer cursor, so the base layer of the app's stylesheet carries one rule that does (buttons, `summary`, `select`, `[role='button']` and button-like inputs, never disabled ones). Keep it, and keep it identical across the apps. Do not add `cursor-pointer` to individual buttons to work around its absence, and do not restyle a link or a button to fake the other: use `<a>` or `<Link>` when the click goes to a URL, and `<button>` when it acts on the current page.

## Shared files

Shared files are byte-identical with plumbline, chowdown, broadsheet, scenery and marshall wherever the app has them. A change to one goes to all, in the same week, and a lint fix in a shared file is made once and copied, never per repository. The shared set is the shell and the plumbing, not the pages: `src/lib/core` except `http/site.ts`, `http/extras.ts`, `http/headers.ts` and `worker-extras.ts`, which are per-app; `src/lib/{http,mcp,oauth,web-security,google,push}`; `src/utils` except `site.ts`; `src/components/api`, `ui/{button,cn,layout,popover}`, `site/{ios-install,skip-link,use-install-prompt}`; the shell files of `src/app` (`_metadata.ts`, `_security-txt.ts`, `manifest.ts`, `robots.ts`, `sitemap.ts`, `error.tsx`, `global-error.tsx`, `layout.tsx`, `not-found.tsx`, `.well-known/security.txt`, `csp/reports`, `health`); `src/domain/mcp/{auth,env,http,request-limits,tool-definitions}.ts`; and their mirrors under `test/`. Plumbline's `AGENTS.md` lists the per-app files. Here they are `src/app/_brand.ts`, `src/utils/site.ts`, `src/lib/intl.ts`, `src/domain/**/app.ts`, the rest of `src/domain/mcp`, `src/components/{icons,notifications}`, `src/components/site/{shell,site-header,site-footer,logo,app-header,install-button,service-worker}`, `src/components/ui/{card,dialog,page-header,skeleton,notice}`, `src/lib/cloudflare/images`, the pages, and the test fixtures `test/fixtures/{insecure-urls,ips}.json` with the tests that read them. Until they are aligned, these shared files stay as broadsheet has them because they depend on app content: `src/components/site/service-worker.tsx` (push subscription), `src/lib/cloudflare/images/{index,proxy,service}.ts` (allowed hosts and widths are inlined, there is no `site.ts`), and the tests that need `package-directory` or the shared fixture helper (`test/app/icons.test.ts`, `test/components/ui/layout.test.tsx`, `test/lib/core/db/{migrations,sqlite-d1,sqlite-db}.ts`, `test/lib/core/http/{client-address,edge-limits}.test.ts`).
