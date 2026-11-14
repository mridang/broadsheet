import { describe, expect, it } from '@jest/globals';

import {
  isAcceptableRedirectUri,
  isLoopbackHost,
  isPrivateHost,
  redirectKind,
  redirectUriMatches,
} from '@/lib/oauth';
import urls from '../../fixtures/insecure-urls.json' with { type: 'json' };
import ips from '../../fixtures/ips.json' with { type: 'json' };

describe('isAcceptableRedirectUri', () => {
  it('accepts https, loopback http and private-use schemes', () => {
    expect(isAcceptableRedirectUri('https://chatgpt.com/cb')).toBe(true);
    expect(isAcceptableRedirectUri('http://localhost:3000/cb')).toBe(true);
    expect(isAcceptableRedirectUri('http://127.0.0.1:8080/cb')).toBe(true);
    expect(isAcceptableRedirectUri('http://[::1]:8080/cb')).toBe(true);
    expect(isAcceptableRedirectUri('claude://auth/callback')).toBe(true);
  });

  it.each([
    'https://claude.ai/mcp/auth_callback',
    'https://claude.com/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector/oauth/abc123',
    'cursor://anysphere.cursor-retrieval/oauth/user-app/callback',
    'http://127.0.0.1:33418/',
    'https://vscode.dev/redirect',
    'vscode://ms-vscode.mcp/auth',
    'vscode-insiders://ms-vscode.mcp/auth',
    'http://localhost:6274/oauth/callback',
    'http://localhost/callback',
    'com.example.app:/oauth2redirect',
    'io.github.someone.client://callback',
  ])('accepts the known client address %s', (uri) => {
    expect(isAcceptableRedirectUri(uri)).toBe(true);
  });

  it.each([
    urls.exampleCallback,
    urls.privateCallback,
    urls.localhostEvil,
    'ws://localhost:3000/cb',
    'wss://example.com/cb',
    'mailto:someone@example.com',
    'tel:+15555550100',
    'intent://scan/#Intent;scheme=zxing;end',
    'chrome://settings',
    'myapp://callback',
    'ftp://example.com/cb',
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'blob:https://example.com/abc',
    'about:blank',
  ])('rejects %s', (uri) => {
    expect(isAcceptableRedirectUri(uri)).toBe(false);
  });

  it.each([
    ['a look-alike letter in the host', 'https://cl\u0430ude.ai/cb'],
    ['a right-to-left override in the path', 'https://claude.ai/\u202Efoo'],
    ['a zero-width space', 'https://claude.ai/c\u200Bb'],
    ['an accented letter in the path', 'https://claude.ai/caf\u00E9'],
    ['a space', 'https://claude.ai/a b'],
    ['a line break', 'https://claude.ai/a\nb'],
  ])('rejects %s, so what is shown is what is stored', (_name, uri) => {
    expect(isAcceptableRedirectUri(uri)).toBe(false);
  });

  it('accepts the percent-encoded form of the same characters', () => {
    expect(isAcceptableRedirectUri('https://claude.ai/caf%C3%A9')).toBe(true);
    expect(isAcceptableRedirectUri('https://xn--clude-5ve.ai/cb')).toBe(true);
  });

  it('rejects fragments, credentials and junk', () => {
    expect(isAcceptableRedirectUri('https://a.com/cb#frag')).toBe(false);
    expect(isAcceptableRedirectUri('https://user:pw@a.com/cb')).toBe(false);
    expect(isAcceptableRedirectUri('not a url')).toBe(false);
  });
});

describe('redirectKind', () => {
  it('tells the web from this computer from an installed app', () => {
    expect(redirectKind('https://claude.ai/cb')).toBe('web');
    expect(redirectKind('http://localhost:6274/cb')).toBe('loopback');
    expect(redirectKind('http://127.0.0.1:1/')).toBe('loopback');
    expect(redirectKind('http://[::1]:1/')).toBe('loopback');
    expect(redirectKind('cursor://anysphere.cursor-retrieval/x')).toBe('app');
    expect(redirectKind('not a url')).toBe('web');
  });

  it.each([
    'https://localhost/cb',
    'https://localhost:8443/cb',
    'https://127.0.0.1:8443/cb',
    'https://127.5.6.7/cb',
    'https://foo.localhost/cb',
    'https://[::1]/cb',
    urls.anyAddressCallback,
    'https://[::ffff:127.0.0.1]/cb',
    'https://2130706433/cb',
  ])('treats %s as this computer whatever the scheme', (uri) => {
    expect(redirectKind(uri)).toBe('loopback');
  });

  it.each([
    'https://192.168.1.5/cb',
    'https://10.0.0.8:8443/cb',
    'https://172.16.0.1/cb',
    'https://172.31.255.255/cb',
    'https://169.254.10.10/cb',
    'https://100.64.0.1/cb',
    'https://[fd12:3456::1]/cb',
    'https://[fe80::1]/cb',
    'https://[::ffff:192.168.1.5]/cb',
    'https://printer.local/cb',
    'https://nas.home.arpa/cb',
    'https://build.internal/cb',
    'https://router.lan/cb',
    'https://nas/cb',
  ])('treats %s as a private network', (uri) => {
    expect(redirectKind(uri)).toBe('private');
  });

  it.each([
    'https://172.15.0.1/cb',
    'https://172.32.0.1/cb',
    'https://100.128.0.1/cb',
    'https://8.8.8.8/cb',
    'https://[2001:db8::1]/cb',
    'https://example.com/cb',
    'https://localhost.evil.com/cb',
    'https://notlocal.example/cb',
  ])('treats %s as the ordinary web', (uri) => {
    expect(redirectKind(uri)).toBe('web');
  });
});

describe('isLoopbackHost and isPrivateHost', () => {
  it('never call a public address either', () => {
    expect(isLoopbackHost('example.com')).toBe(false);
    expect(isPrivateHost('example.com')).toBe(false);
    expect(isLoopbackHost(ips.private192)).toBe(false);
    expect(isPrivateHost('127.0.0.1')).toBe(false);
  });
});

describe('redirectUriMatches', () => {
  const registered = ['https://a.com/cb', 'http://localhost:3000/cb'];

  it('matches a registered URI exactly', () => {
    expect(redirectUriMatches('https://a.com/cb', registered)).toBe(true);
  });

  it('refuses anything else, including a different path or query', () => {
    expect(redirectUriMatches('https://a.com/other', registered)).toBe(false);
    expect(redirectUriMatches('https://a.com/cb?x=1', registered)).toBe(false);
    expect(redirectUriMatches('https://evil.com/cb', registered)).toBe(false);
  });

  it('lets a loopback URI use any port', () => {
    expect(redirectUriMatches('http://localhost:54321/cb', registered)).toBe(
      true,
    );
    expect(redirectUriMatches('http://localhost:54321/other', registered)).toBe(
      false,
    );
  });

  it('does not extend the port freedom to real hosts', () => {
    expect(redirectUriMatches('https://a.com:8443/cb', registered)).toBe(false);
  });
});
