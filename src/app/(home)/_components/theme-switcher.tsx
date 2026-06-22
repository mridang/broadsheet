'use client';

import { useEffect, useRef } from 'react';

type Theme = 'ft' | 'economist';
const FALLBACK: Record<Theme, string> = { ft: '#990F3D', economist: '#E3120B' };

/** FT/Economist toggle: recolours the address bar (theme-color) and persists. */
export function ThemeSwitcher() {
  const ref = useRef<HTMLDivElement>(null);

  const setPressed = (t: Theme): void => {
    ref.current?.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset['theme'] === t));
    });
  };

  const apply = (t: Theme): void => {
    const html = document.documentElement;
    html.setAttribute('data-theme', t);
    const c =
      getComputedStyle(html).getPropertyValue('--themecolor').trim() ||
      FALLBACK[t];
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta && c) meta.setAttribute('content', c);
    try {
      localStorage.setItem('ht-theme', t);
    } catch {
      /* private mode — ignore */
    }
    setPressed(t);
  };

  // Sync the pressed indicator to the theme the no-flash script already applied
  // (imperative DOM, no React state — the source of truth is <html data-theme>).
  useEffect(() => {
    const cur = document.documentElement.getAttribute('data-theme');
    setPressed(cur === 'economist' ? 'economist' : 'ft');
  }, []);

  return (
    <div className="switcher" role="group" aria-label="Theme" ref={ref}>
      <button data-theme="ft" aria-pressed="true" onClick={() => apply('ft')}>
        FT
      </button>
      <button
        data-theme="economist"
        aria-pressed="false"
        onClick={() => apply('economist')}
      >
        Economist
      </button>
    </div>
  );
}
