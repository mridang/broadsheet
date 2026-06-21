# broadsheet

**The Hacker Times** — a single-page newspaper rendering of the Hacker News front
page, as a Next.js app.

This is a port of an earlier static-HTML snapshot (the front page of
Friday, June 19, 2026) into a typed Next.js App Router project. The design is
unchanged: two themes (FT / Economist), a masonry layout engine (CSS Grid
Level 3 "grid-lanes" where supported, multicolumn fallback elsewhere), a
weight-driven tier system (lead / feature / standard, with a low-weight tail
collapsed into "In Brief" rails), float-wrapped lead images, and a PWA manifest.

## Structure

- `app/` — App Router entry: `layout.tsx` (head, fonts, no-flash theme script),
  `page.tsx`, `globals.css` (the original stylesheet verbatim), `manifest.ts`.
- `components/` — `Masthead`, `SectionView`, `StoryCard`, `BriefBlock`, plus the
  client `ThemeSwitcher` and `InstallButton`.
- `lib/` — `types.ts` (the data model) and `newspaper.ts` (data + edition meta).
- `data/newspaper.json` — the extracted front page (sections, stories, briefs,
  jobs).
- `public/{img,favicons,icons}/` — bundled article images, per-article favicons,
  and PWA icons.
- `scripts/extract.mjs` — one-time extractor that produced `data/newspaper.json`
  from the original `newspaper/index.html`. Kept for provenance; not part of the
  build.

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static export to ./out
```

The content is a frozen snapshot; there is no live Hacker News fetch.
