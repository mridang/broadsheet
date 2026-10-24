import { describe, expect, it } from '@jest/globals';

import {
  buildCsp,
  cspSurfaceFor,
  forwardedHeaders,
  newNonce,
  nonceOf,
} from '@/core/http/csp';
import { EXTRA_DIRECTIVES, EXTRA_IMG_SOURCES } from '@/core/http/site';

describe('newNonce', () => {
  it('is base64 of 16 bytes, and different every time', () => {
    const a = newNonce();
    expect(Buffer.from(a, 'base64')).toHaveLength(16);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(newNonce()).not.toBe(a);
  });
});

describe('buildCsp', () => {
  const csp = buildCsp('abc123==');
  const directive = (name: string) =>
    csp.split('; ').find((d) => d.startsWith(`${name} `));

  it('lets only scripts that carry the nonce run, and the ones they load', () => {
    expect(directive('script-src')).toBe(
      "script-src 'self' 'nonce-abc123==' 'strict-dynamic'",
    );
  });

  it('never allows inline script or eval, beyond the directives site.ts names', () => {
    const rest = csp
      .split('; ')
      .filter((d) => !EXTRA_DIRECTIVES.includes(d))
      .join('; ');
    expect(rest).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('denies by default, so only what is listed can load', () => {
    expect(directive('default-src')).toBe("default-src 'none'");
  });

  it.each([
    'script-src',
    'style-src',
    'img-src',
    'font-src',
    'connect-src',
    'manifest-src',
    'worker-src',
  ])('names %s itself, since nothing falls back to the default', (name) => {
    expect(directive(name)).toMatch(new RegExp(`^${name} 'self'`));
  });

  it('allows pictures from this site and the places site.ts names, nothing else', () => {
    expect(directive('img-src')).toBe(
      ['img-src', "'self'", 'data:', ...EXTRA_IMG_SOURCES].join(' '),
    );
    expect(directive('connect-src')).toBe("connect-src 'self'");
    expect(directive('font-src')).toBe("font-src 'self'");
  });

  it('adds the directives site.ts names to both kinds of policy', () => {
    for (const surface of ['site', 'approval'] as const) {
      const directives = buildCsp('abc123==', surface).split('; ');
      for (const extra of EXTRA_DIRECTIVES) {
        expect(directives).toContain(extra);
      }
    }
  });

  it('forbids plugins, frames, media and a rewritten <base>', () => {
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('frame-src')).toBe("frame-src 'none'");
    expect(directive('media-src')).toBe("media-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
  });

  it('only lets this site frame it, and forces https', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('forbids framing altogether on the approval screen', () => {
    const approval = buildCsp('abc123==', 'approval');
    expect(approval).toContain("frame-ancestors 'none'");
    expect(approval).toContain("script-src 'self' 'nonce-abc123=='");
  });

  it('names no form-action on the approval screen, so its redirect back to the app is allowed', () => {
    // A browser checks the consent form's redirect (to the client's address)
    // against form-action. `'self'` there would block returning to ChatGPT or
    // Claude after approval.
    expect(buildCsp('abc123==', 'approval')).not.toContain('form-action');
    expect(buildCsp('abc123==', 'site')).toContain("form-action 'self'");
  });

  it('puts the nonce on styles as well', () => {
    expect(directive('style-src')).toBe("style-src 'self' 'nonce-abc123=='");
  });
});

describe('nonceOf', () => {
  it('reads the nonce back out of a policy, which is how Next.js finds it', () => {
    expect(nonceOf(buildCsp('xyz=='))).toBe('xyz==');
    expect(nonceOf("default-src 'self'")).toBeUndefined();
  });
});

describe('forwardedHeaders', () => {
  it('replaces a policy and nonce sent by the caller instead of adding to them', () => {
    const incoming = new Headers({
      'content-security-policy': "script-src 'nonce-ATTACKER'",
      'x-nonce': 'ATTACKER',
      accept: 'text/html',
    });
    const csp = buildCsp('REAL');
    const forwarded = forwardedHeaders(incoming, csp, 'REAL');
    expect(forwarded.get('content-security-policy')).toBe(csp);
    expect(nonceOf(forwarded.get('content-security-policy')!)).toBe('REAL');
    expect(forwarded.get('x-nonce')).toBe('REAL');
    expect(forwarded.get('accept')).toBe('text/html');
  });

  it('leaves the caller’s own headers object alone', () => {
    const incoming = new Headers({ accept: 'text/html' });
    forwardedHeaders(incoming, 'x', 'y');
    expect(incoming.has('content-security-policy')).toBe(false);
  });
});

describe('cspSurfaceFor', () => {
  it('gives the approval screen its own policy and every other path the site policy', () => {
    expect(cspSurfaceFor('/oauth/authorize')).toBe('approval');
    for (const pathname of [
      '/',
      '/some/page',
      '/oauth/consent',
      '/oauth/authorize/x',
      '/mcp',
    ]) {
      expect(cspSurfaceFor(pathname)).toBe('site');
    }
  });
});

describe('reporting', () => {
  it('points every policy at the report group and address', () => {
    for (const surface of ['site', 'approval'] as const) {
      const csp = buildCsp('abc', surface);
      expect(csp).toContain('report-to csp-endpoint');
      expect(csp).toContain('report-uri /csp/reports');
    }
  });
});
