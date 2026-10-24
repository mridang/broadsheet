import { describe, expect, it, jest } from '@jest/globals';

import { THEME_COLOR } from '@/app/_brand';
import { html } from '../render';

jest.unstable_mockModule('next/headers', () => ({
  headers: async () => new Headers({ 'x-nonce': 'abc123' }),
}));

const { ThemeScript } = await import('@/components/site/theme-script');

describe('ThemeScript', () => {
  it('is an inline script that carries this response’s nonce, which the policy requires', async () => {
    const out = html(await ThemeScript());
    expect(out.startsWith('<script')).toBe(true);
    expect(out).toContain('nonce="abc123"');
  });

  it('applies the saved theme, and the bar colour that goes with it, before the first paint', async () => {
    const out = html(await ThemeScript());
    expect(out).toContain("localStorage.getItem('ht-theme')||'ft'");
    expect(out).toContain("setAttribute('data-theme',t)");
    expect(out).toContain('meta[name=theme-color]');
    expect(out).toContain(
      `&quot;ft&quot;:&quot;${THEME_COLOR}&quot;`.replace(/&quot;/g, '"'),
    );
  });
});
