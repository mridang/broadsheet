import { headers } from 'next/headers';
import type { ReactElement } from 'react';

import { THEME_COLOR } from '@/app/_brand';

/** The theme colours of the browser's bar, by theme (see the switcher). */
const BAR_COLORS: Readonly<Record<string, string>> = {
  ft: THEME_COLOR,
  economist: '#E3120B',
};

/**
 * Applies the saved theme and the browser bar's colour before the first paint,
 * so a returning reader never sees the default theme flash. It is a raw inline
 * script in `<head>` (`next/script` with children is invalid in Next 16), and
 * the Content Security Policy only lets it run with this response's one-time
 * number: the Worker puts it in the `x-nonce` header, and it is read here.
 */
export async function ThemeScript(): Promise<ReactElement> {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const script =
    "(function(){try{var t=localStorage.getItem('ht-theme')||'ft';" +
    `var c=${JSON.stringify(BAR_COLORS)}[t]||${JSON.stringify(THEME_COLOR)};` +
    "document.documentElement.setAttribute('data-theme',t);" +
    "var m=document.querySelector('meta[name=theme-color]');" +
    "if(m)m.setAttribute('content',c);}catch(e){}})();";
  return (
    <script
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
