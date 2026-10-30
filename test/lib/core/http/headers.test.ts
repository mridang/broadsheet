import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  SECURITY_HEADERS,
  applyResponseHeaders,
  openerPolicyFor,
  replacingHeaders,
  resourcePolicyFor,
  PAGE_CACHE_RULES,
  PUBLIC_PAGES,
  RARELY_CHANGING,
} from '@/lib/core/http';

const at = (pathname: string) => new Request(`https://app.test${pathname}`);

/** Pages and endpoints no app makes public, whatever its `site.ts` says. */
const PRIVATE_PATHS = ['/some/page', '/some/page/abc', '/api/things'];

/** The small files the app lists as open to other sites and cacheable. */
const CACHED_FILES = [...RARELY_CHANGING];
const html = (headers: Record<string, string> = {}) =>
  new Response('<p>hi</p>', {
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });

describe('openerPolicyFor', () => {
  it('lets the window that opened the approval screen keep its link to it', () => {
    expect(openerPolicyFor('/oauth/authorize')).toBe('unsafe-none');
  });

  it('cuts other windows off everywhere else', () => {
    for (const pathname of [
      '/',
      '/some/page',
      '/oauth/consent',
      '/oauth/token',
      '/mcp',
    ]) {
      expect(openerPolicyFor(pathname)).toBe('same-origin');
    }
  });
});

describe('applyResponseHeaders — files other sites and browsers fetch', () => {
  it('serves every cached file to other sites and does not mark it noindex', () => {
    for (const pathname of CACHED_FILES) {
      const out = applyResponseHeaders(at(pathname), new Response('x'));
      expect(out.headers.get('cross-origin-resource-policy')).toBe(
        'cross-origin',
      );
      expect(out.headers.has('x-robots-tag')).toBe(false);
    }
  });

  it('lets a browser keep every cached file for a day', () => {
    for (const pathname of CACHED_FILES) {
      const out = applyResponseHeaders(at(pathname), new Response('x'));
      expect(out.headers.get('cache-control')).toBe(
        'public, max-age=86400, stale-while-revalidate=604800',
      );
    }
  });
});

describe('applyResponseHeaders', () => {
  it('sends the approval screen with an opener policy a popup client can live with', () => {
    expect(
      applyResponseHeaders(at('/oauth/authorize'), html()).headers.get(
        'cross-origin-opener-policy',
      ),
    ).toBe('unsafe-none');
    expect(
      applyResponseHeaders(at('/some/page'), html()).headers.get(
        'cross-origin-opener-policy',
      ),
    ).toBe('same-origin');
  });

  it('adds the security headers to every response', async () => {
    const out = applyResponseHeaders(at('/some/page'), html());
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
      at('/some/page/abc'),
      html({
        'Cache-Control':
          'private, no-cache, no-store, max-age=0, must-revalidate',
      }),
    );
    expect(out.headers.get('Cache-Control')).toBe('private, no-cache');
  });

  it('leaves the cache rules of the API and the sign-in pages alone', () => {
    const api = applyResponseHeaders(
      at('/api/things'),
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

  it('leaves the cache rule of any other file as the response set it', () => {
    const out = applyResponseHeaders(
      at('/some/file.bin'),
      new Response('x', { headers: { 'Cache-Control': 'max-age=5' } }),
    );
    expect(out.headers.get('Cache-Control')).toBe('max-age=5');
  });

  it('keeps the status of a redirect', () => {
    const out = applyResponseHeaders(
      at('/'),
      Response.redirect('https://app.test/some/page', 307),
    );
    expect(out.status).toBe(307);
    expect(out.headers.get('Location')).toBe('https://app.test/some/page');
  });
});

describe('Cross-Origin-Resource-Policy', () => {
  it('keeps pages and data to this site', () => {
    for (const path of ['/', '/some/page', '/some/page/abc', '/api/things']) {
      expect(resourcePolicyFor(path)).toBe('same-site');
    }
  });

  it('opens the files other sites embed or fetch on purpose', () => {
    for (const path of CACHED_FILES) {
      expect(resourcePolicyFor(path)).toBe('cross-origin');
    }
  });

  it('is sent on every response, and a route may set its own', () => {
    const [cached = '/'] = CACHED_FILES;
    expect(
      applyResponseHeaders(at('/some/page'), html()).headers.get(
        'Cross-Origin-Resource-Policy',
      ),
    ).toBe('same-site');
    expect(
      applyResponseHeaders(at(cached), html()).headers.get(
        'Cross-Origin-Resource-Policy',
      ),
    ).toBe('cross-origin');
    expect(
      applyResponseHeaders(
        at('/some/page'),
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
  it('keeps crawlers out of every page except the ones the app makes public', () => {
    for (const path of [...PRIVATE_PATHS, '/oauth/authorize']) {
      expect(
        applyResponseHeaders(at(path), html()).headers.get('X-Robots-Tag'),
      ).toBe('noindex, nofollow');
    }
    for (const path of PUBLIC_PAGES) {
      expect(
        applyResponseHeaders(at(path), html()).headers.get('X-Robots-Tag'),
      ).toBeNull();
    }
  });

  it('leaves the files crawlers are meant to read unmarked', () => {
    for (const path of CACHED_FILES) {
      expect(
        applyResponseHeaders(at(path), html()).headers.get('X-Robots-Tag'),
      ).toBeNull();
    }
  });
});

describe('applyResponseHeaders — page cache rules', () => {
  it('gives each of the app’s own rules exactly that rule', () => {
    for (const [pathname, rule] of Object.entries(PAGE_CACHE_RULES)) {
      const out = applyResponseHeaders(at(pathname), html());
      expect(out.headers.get('cache-control')).toBe(rule);
    }
  });

  it('keeps pages private on a path with no rule', () => {
    const pathname = '/no-rule-for-this-path';
    expect(Object.keys(PAGE_CACHE_RULES)).not.toContain(pathname);
    const out = applyResponseHeaders(at(pathname), html());
    expect(out.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('uses an app’s rule for its path, and the default elsewhere', () => {
    const rules = { '/shared': 'public, max-age=60' };
    const ruled = applyResponseHeaders(at('/shared'), html(), rules);
    const other = applyResponseHeaders(at('/other'), html(), rules);
    expect(ruled.headers.get('cache-control')).toBe('public, max-age=60');
    expect(other.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('does not mistake an inherited property for a rule', () => {
    const out = applyResponseHeaders(at('/toString'), html(), {});
    expect(out.headers.get('cache-control')).toBe('private, no-cache');
  });
});

describe('SECURITY_HEADERS', () => {
  it('forbids framing by anyone', () => {
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain(
      "frame-ancestors 'none'",
    );
  });

  it('puts the origin in its own agent cluster', () => {
    expect(SECURITY_HEADERS['Origin-Agent-Cluster']).toBe('?1');
  });

  it('names no permissions feature that browsers have removed', () => {
    expect(SECURITY_HEADERS['Permissions-Policy']).not.toContain(
      'interest-cohort',
    );
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

  it('gives static files the default resource policy and detaches it where files are open', () => {
    const file = readFileSync(
      path.join(process.cwd(), 'public/_headers'),
      'utf8',
    );
    expect(file).toContain(
      `Cross-Origin-Resource-Policy: ${resourcePolicyFor('/some/file')}`,
    );
    const open = file
      .split('\n')
      .filter((l) => l.trim() === 'Cross-Origin-Resource-Policy: cross-origin');
    const detached = file
      .split('\n')
      .filter((l) => l.trim() === '! Cross-Origin-Resource-Policy');
    expect(open.length).toBeGreaterThan(0);
    expect(detached).toHaveLength(open.length);
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
    for (const pathname of [
      '/',
      '/some/page',
      '/api/things',
      '/oauth/authorize',
    ]) {
      expect(
        applyResponseHeaders(at(pathname), html()).headers.get(
          'reporting-endpoints',
        ),
      ).toBe('csp-endpoint="/csp/reports"');
    }
  });
});
