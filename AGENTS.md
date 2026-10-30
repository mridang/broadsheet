<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## Tailwind

Tailwind 4 no longer gives `<button>` the pointer cursor, so the base layer of the app's stylesheet carries one rule that does (buttons, `summary`, `select`, `[role='button']` and button-like inputs, never disabled ones). Keep it, and keep it identical across the apps. Do not add `cursor-pointer` to individual buttons to work around its absence, and do not restyle a link or a button to fake the other: use `<a>` or `<Link>` when the click goes to a URL, and `<button>` when it acts on the current page.
