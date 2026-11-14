import { describe, expect, it } from '@jest/globals';

import {
  APP_SCHEME_WARNING,
  LOOPBACK_WARNING,
  PRIVATE_WARNING,
  MAX_DISPLAY_NAME_LENGTH,
  NEUTRAL_CLIENT_NAME,
  clientIdentity,
  describeRedirect,
  describeScopes,
  sanitiseDisplayName,
} from '@/lib/oauth';
import { SCOPE_READ, SCOPE_TEXT, SCOPE_WRITE } from '@/domain/mcp/app';

describe('sanitiseDisplayName', () => {
  it('keeps an ordinary name', () => {
    expect(sanitiseDisplayName('Claude Desktop', 'x')).toBe('Claude Desktop');
  });

  it('strips bidi overrides and isolates', () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE would make "Claude" read backwards.
    expect(sanitiseDisplayName('‮Claude‬', 'x')).toBe('Claude');
    expect(sanitiseDisplayName('Cl⁦au⁩de', 'x')).toBe('Claude');
  });

  it('strips zero-width characters, the BOM and tag characters', () => {
    expect(sanitiseDisplayName('Cl​aude‍﻿', 'x')).toBe('Claude');
    expect(sanitiseDisplayName('Claude\u{E0041}\u{E0042}', 'x')).toBe('Claude');
  });

  it('strips control characters', () => {
    expect(sanitiseDisplayName('Cla\u0000ude\u0007\u007F', 'x')).toBe('Claude');
  });

  it('collapses whitespace, line breaks included', () => {
    expect(sanitiseDisplayName('  Claude \n\n  Desktop\t', 'x')).toBe(
      'Claude Desktop',
    );
    expect(sanitiseDisplayName('A B C', 'x')).toBe('A B C');
  });

  it('normalises look-alike forms to the plain letters', () => {
    expect(sanitiseDisplayName('Ｃｌａｕｄｅ', 'x')).toBe('Claude');
  });

  it('caps the length without cutting a character in half', () => {
    const long = sanitiseDisplayName('x'.repeat(500), 'x');
    expect(long).toHaveLength(MAX_DISPLAY_NAME_LENGTH);
    const emoji = sanitiseDisplayName('\u{1F372}'.repeat(150), 'x');
    expect([...emoji]).toHaveLength(MAX_DISPLAY_NAME_LENGTH);
    expect(emoji.includes('�')).toBe(false);
  });

  it('falls back when nothing readable is left or the input is not text', () => {
    expect(sanitiseDisplayName('', 'fallback')).toBe('fallback');
    expect(sanitiseDisplayName(' '.repeat(3), 'fallback')).toBe('fallback');
    expect(sanitiseDisplayName('​‮', 'fallback')).toBe('fallback');
    expect(sanitiseDisplayName(undefined, 'fallback')).toBe('fallback');
    expect(sanitiseDisplayName(42, 'fallback')).toBe('fallback');
  });

  it('leaves markup as text for the renderer to escape', () => {
    expect(sanitiseDisplayName('<img src=x onerror=alert(1)>', 'x')).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('has a neutral label for an unnamed app', () => {
    expect(NEUTRAL_CLIENT_NAME).toBe('An unnamed app');
  });
});

describe('clientIdentity', () => {
  it('identifies a metadata-document client by the host of its client_id', () => {
    expect(
      clientIdentity({
        clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
        kind: 'cimd',
      }),
    ).toEqual({ kind: 'domain', domain: 'claude.ai' });
  });

  it('keeps a non-default port in the domain', () => {
    expect(
      clientIdentity({
        clientId: 'https://app.example:8443/c.json',
        kind: 'cimd',
      }),
    ).toEqual({ kind: 'domain', domain: 'app.example:8443' });
  });

  it('calls a registered client unverified', () => {
    expect(clientIdentity({ clientId: 'dcr_abc', kind: 'dcr' })).toEqual({
      kind: 'unverified',
    });
  });

  it('calls a metadata client with an unreadable id unverified', () => {
    expect(clientIdentity({ clientId: 'not a url', kind: 'cimd' })).toEqual({
      kind: 'unverified',
    });
  });
});

describe('describeRedirect', () => {
  it('gives the whole address and no warning for an https address', () => {
    expect(describeRedirect('https://claude.ai/mcp/auth_callback')).toEqual({
      address: 'https://claude.ai/mcp/auth_callback',
      kind: 'web',
      short: 'claude.ai',
    });
  });

  it('warns that a loopback address is the person own computer', () => {
    const redirect = describeRedirect('http://localhost:6274/oauth/callback');
    expect(redirect).toMatchObject({
      kind: 'loopback',
      short: 'localhost:6274',
      address: 'http://localhost:6274/oauth/callback',
      warning: LOOPBACK_WARNING,
    });
    expect(LOOPBACK_WARNING).toContain('your own computer');
  });

  it('treats 127.0.0.1 and [::1] as the same warning', () => {
    expect(describeRedirect('http://127.0.0.1:33418/').warning).toBe(
      LOOPBACK_WARNING,
    );
    expect(describeRedirect('http://[::1]:3000/cb').warning).toBe(
      LOOPBACK_WARNING,
    );
  });

  it('notes that an app scheme opens an installed app', () => {
    expect(
      describeRedirect('cursor://anysphere.cursor-retrieval/oauth/x/callback'),
    ).toMatchObject({
      kind: 'app',
      short: 'anysphere.cursor-retrieval',
      warning: APP_SCHEME_WARNING,
    });
  });

  it('shows the scheme when an app address has no host', () => {
    expect(describeRedirect('com.example.app:/cb').short).toBe(
      'com.example.app:',
    );
  });

  it('shows the ASCII form of an international host, so a look-alike cannot pass for the real one', () => {
    const redirect = describeRedirect('https://xn--clude-5ve.ai/cb');
    expect(redirect.address).toBe('https://xn--clude-5ve.ai/cb');
    expect(redirect.short).toBe('xn--clude-5ve.ai');
    // `URL` itself turns a Unicode host into this form.
    expect(describeRedirect('https://cl\u0430ude.ai/cb').address).toBe(
      'https://xn--clude-5ve.ai/cb',
    );
  });

  it('never lets a direction-changing or invisible character reach the screen', () => {
    const address = describeRedirect(
      'https://claude.ai/\u202Efoo\u200B',
    ).address;
    expect(address).not.toMatch(/[^\u0021-\u007E]/);
    expect(address).toBe('https://claude.ai/%E2%80%AEfoo%E2%80%8B');
    const unreadable = describeRedirect('not a url \u202E');
    expect(unreadable.address).not.toMatch(/[^\u0021-\u007E]/);
    expect(unreadable.address).toContain(String.raw`\u{202e}`);
  });

  it.each([
    'https://localhost/cb',
    'https://127.0.0.1:8443/cb',
    'https://foo.localhost/cb',
  ])('warns that %s is the person own computer, whatever the scheme', (uri) => {
    expect(describeRedirect(uri)).toMatchObject({
      kind: 'loopback',
      warning: LOOPBACK_WARNING,
    });
  });

  it.each([
    'https://192.168.1.5/cb',
    'https://printer.local/cb',
    'https://[fd00::1]/cb',
  ])('warns that %s is on a private network', (uri) => {
    expect(describeRedirect(uri)).toMatchObject({
      kind: 'private',
      warning: PRIVATE_WARNING,
    });
  });

  describe('the note about a different site', () => {
    const published = { kind: 'domain', domain: 'claude.ai' } as const;

    it('stays quiet when the redirect is on the publishing domain or one of its subdomains', () => {
      for (const uri of [
        'https://claude.ai/cb',
        'https://app.claude.ai/cb',
        'https://claude.ai:8443/cb',
      ]) {
        expect(describeRedirect(uri, published).note).toBeUndefined();
      }
    });

    it('stays quiet when the publishing domain is a subdomain of the redirect host', () => {
      expect(
        describeRedirect('https://claude.ai/cb', {
          kind: 'domain',
          domain: 'app.claude.ai',
        }).note,
      ).toBeUndefined();
    });

    it('says so, neutrally, when the redirect is on an unrelated site', () => {
      const { note } = describeRedirect(
        'https://elsewhere.example/cb',
        published,
      );
      expect(note).toContain('claude.ai');
      expect(note).toContain('not on');
    });

    it('does not apply to an app address, to this computer or to an unverified client', () => {
      expect(
        describeRedirect('cursor://x.y/cb', published).note,
      ).toBeUndefined();
      expect(
        describeRedirect('http://localhost:1/cb', published).note,
      ).toBeUndefined();
      expect(
        describeRedirect('https://elsewhere.example/cb', { kind: 'unverified' })
          .note,
      ).toBeUndefined();
    });
  });

  it('shows an unreadable address as written, with anything outside printable ASCII spelled out', () => {
    expect(describeRedirect('not-a-url').short).toBe('not-a-url');
  });
});

describe('describeScopes', () => {
  it('puts each scope in plain words and shows an unknown one as it is', () => {
    expect(describeScopes([SCOPE_READ, SCOPE_WRITE, 'other'])).toEqual([
      SCOPE_TEXT[SCOPE_READ],
      SCOPE_TEXT[SCOPE_WRITE],
      'other',
    ]);
  });
});
