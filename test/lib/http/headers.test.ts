import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  SECURITY_HEADERS,
  applyResponseHeaders,
  openerPolicyFor,
  replacingHeaders,
  resourcePolicyFor,
} from '../../../src/lib/http/headers';

const at = (pathname: string) =>
  new Request(`https://broadsheet.test${pathname}`);
const html = (headers: Record<string, string> = {}) =>
  new Response('<p>hi</p>', {
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });

describe('openerPolicyFor', () => {
  it('lets the window that opened the approval screen keep its link to it', () => {
    expect(openerPolicyFor('/oauth/authorize')).toBe('unsafe-none');
  });

  it('cuts other windows off everywhere else', () => {
    for (const pathname of ['/', '/feeds', '/login', '/api/feeds']) {
      expect(openerPolicyFor(pathname)).toBe('same-origin');
    }
  });
});

describe('applyResponseHeaders — files other sites and browsers fetch', () => {
  it.each([
    '/favicon.ico',
    '/icon.svg',
    '/manifest.webmanifest',
    '/.well-known/security.txt',
  ])('serves %s to other sites and does not mark it noindex', (pathname) => {
    const out = applyResponseHeaders(at(pathname), new Response('x'));
    expect(out.headers.get('cross-origin-resource-policy')).toBe(
      'cross-origin',
    );
    expect(out.headers.has('x-robots-tag')).toBe(false);
  });

  it.each(['/favicon.ico', '/icon.svg'])(
    'lets a browser keep %s for a day',
    (pathname) => {
      const out = applyResponseHeaders(at(pathname), new Response('x'));
      expect(out.headers.get('cache-control')).toContain('max-age=86400');
    },
  );
});

describe('applyResponseHeaders', () => {
  it('sends the approval screen with an opener policy a popup client can live with', () => {
    expect(
      applyResponseHeaders(at('/oauth/authorize'), html()).headers.get(
        'cross-origin-opener-policy',
      ),
    ).toBe('unsafe-none');
    expect(
      applyResponseHeaders(at('/feeds'), html()).headers.get(
        'cross-origin-opener-policy',
      ),
    ).toBe('same-origin');
  });

  it('adds the security headers to every response', async () => {
    const out = applyResponseHeaders(at('/feeds'), html());
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(out.headers.get(name)).toBe(value);
    }
    expect(await out.text()).toBe('<p>hi</p>');
  });

  it('keeps the security headers a route set itself', () => {
    const out = applyResponseHeaders(
      at('/oauth/authorize'),
      html({
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "frame-ancestors 'none'",
      }),
    );
    expect(out.headers.get('X-Frame-Options')).toBe('DENY');
    expect(out.headers.get('Content-Security-Policy')).toBe(
      "frame-ancestors 'none'",
    );
  });

  it('lets personal pages be restored by the back button but never shared', () => {
    const out = applyResponseHeaders(
      at('/feeds/abc'),
      html({
        'Cache-Control':
          'private, no-cache, no-store, max-age=0, must-revalidate',
      }),
    );
    expect(out.headers.get('Cache-Control')).toBe('private, no-cache');
  });

  it('leaves the cache rules of the API and the sign-in pages alone', () => {
    const api = applyResponseHeaders(
      at('/api/feeds'),
      new Response('{}', {
        headers: {
          'content-type': 'application/json',
          'Cache-Control': 'private, max-age=0',
        },
      }),
    );
    expect(api.headers.get('Cache-Control')).toBe('private, max-age=0');
    const consent = applyResponseHeaders(
      at('/oauth/authorize'),
      html({ 'Cache-Control': 'no-store' }),
    );
    expect(consent.headers.get('Cache-Control')).toBe('no-store');
  });

  it('lets the manifest and icons be cached for a day', () => {
    for (const p of ['/manifest.webmanifest', '/icon.svg', '/apple-icon.png']) {
      const out = applyResponseHeaders(at(p), new Response('x'));
      expect(out.headers.get('Cache-Control')).toContain('max-age=86400');
    }
  });

  it('keeps the status of a redirect', () => {
    const out = applyResponseHeaders(
      at('/'),
      Response.redirect('https://broadsheet.test/feeds', 307),
    );
    expect(out.status).toBe(307);
    expect(out.headers.get('Location')).toBe('https://broadsheet.test/feeds');
  });
});

describe('Cross-Origin-Resource-Policy', () => {
  it('keeps pages and data to this site', () => {
    for (const path of ['/', '/feeds', '/login', '/api/feeds', '/img']) {
      expect(resourcePolicyFor(path)).toBe('same-site');
    }
  });

  it('opens the files other sites embed or fetch on purpose', () => {
    for (const path of [
      '/icon.svg',
      '/favicon.ico',
      '/manifest.webmanifest',
      '/robots.txt',
      '/sitemap.xml',
      '/.well-known/security.txt',
    ]) {
      expect(resourcePolicyFor(path)).toBe('cross-origin');
    }
  });

  it('is sent on every response, and a route may set its own', () => {
    expect(
      applyResponseHeaders(at('/feeds'), html()).headers.get(
        'Cross-Origin-Resource-Policy',
      ),
    ).toBe('same-site');
    expect(
      applyResponseHeaders(at('/icon.svg'), html()).headers.get(
        'Cross-Origin-Resource-Policy',
      ),
    ).toBe('cross-origin');
    expect(
      applyResponseHeaders(
        at('/feeds'),
        html({ 'Cross-Origin-Resource-Policy': 'same-origin' }),
      ).headers.get('Cross-Origin-Resource-Policy'),
    ).toBe('same-origin');
  });
});

describe('Strict-Transport-Security', () => {
  it('lasts two years, covers subdomains and asks to be preloaded', () => {
    expect(SECURITY_HEADERS['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
  });
});

describe('X-Robots-Tag', () => {
  it('keeps crawlers out of every page except the public one', () => {
    for (const path of ['/feeds', '/login', '/api/feeds', '/oauth/authorize']) {
      expect(
        applyResponseHeaders(at(path), html()).headers.get('X-Robots-Tag'),
      ).toBe('noindex, nofollow');
    }
    for (const path of ['/']) {
      expect(
        applyResponseHeaders(at(path), html()).headers.get('X-Robots-Tag'),
      ).toBeNull();
    }
  });

  it('leaves the files crawlers are meant to read unmarked', () => {
    for (const path of [
      '/robots.txt',
      '/sitemap.xml',
      '/.well-known/security.txt',
    ]) {
      expect(
        applyResponseHeaders(at(path), html()).headers.get('X-Robots-Tag'),
      ).toBeNull();
    }
  });
});

describe('public/_headers', () => {
  it('gives static files the same security headers as the Worker gives pages', () => {
    const file = readFileSync(
      path.join(process.cwd(), 'public/_headers'),
      'utf8',
    );
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(file).toContain(`${name}: ${value}`);
    }
  });
});

describe('replacingHeaders', () => {
  it('sets new headers and replaces ones of the same name, in any case', () => {
    const original = new Headers({ 'X-A': '1', 'Content-Type': 'text/html' });
    const changed = replacingHeaders(original, { 'x-a': '2', 'X-B': '3' });
    expect(changed.get('x-a')).toBe('2');
    expect(changed.get('x-b')).toBe('3');
    expect(changed.get('content-type')).toBe('text/html');
  });

  it('leaves the original headers as they were', () => {
    const original = new Headers({ 'X-A': '1' });
    replacingHeaders(original, { 'X-A': '2' });
    expect(original.get('x-a')).toBe('1');
  });

  it('keeps every cookie', () => {
    const original = new Headers();
    original.append('Set-Cookie', 'a=1');
    original.append('Set-Cookie', 'b=2');
    expect(replacingHeaders(original, { 'X-A': '1' }).getSetCookie()).toEqual([
      'a=1',
      'b=2',
    ]);
  });
});

describe('applyResponseHeaders — reporting', () => {
  it('tells the browser where the policies send their reports, on every response', () => {
    for (const pathname of ['/', '/feeds', '/api/feeds', '/oauth/authorize']) {
      expect(
        applyResponseHeaders(at(pathname), html()).headers.get(
          'reporting-endpoints',
        ),
      ).toBe('csp-endpoint="/api/csp-reports"');
    }
  });
});
