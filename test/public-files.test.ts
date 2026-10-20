import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { BRAND_NAME, BRAND_URL, SECURITY_CONTACT } from '../src/app/_brand';

const read = (name: string) =>
  readFileSync(path.join(process.cwd(), 'public', name), 'utf8');

/** Plain-text files are served without a charset, so they must be ASCII. */
const NON_ASCII = /[\u0080-￿]/;

describe('public/llms.txt', () => {
  const text = read('llms.txt');
  /** The part before `## Optional`: what an assistant should read first. */
  const main = text.split('\n## Optional')[0] ?? '';

  it('follows the llms.txt shape: a title, a summary and sections of links', () => {
    expect(text.startsWith(`# ${BRAND_NAME}\n`)).toBe(true);
    expect(text).toMatch(/\n> .+/);
    expect(text).toMatch(/\n## .+/);
  });

  it('links only to this site, outside the Optional section', () => {
    const links = [...main.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.startsWith(`${BRAND_URL}/`)).toBe(true);
    }
  });

  it('points to the security contact and policy, under Optional', () => {
    const optional = text.split('\n## Optional')[1] ?? '';
    expect(optional).toContain(`${BRAND_URL}/.well-known/security.txt`);
    expect(optional).toContain(`${BRAND_URL}/security-policy.txt`);
  });

  it('is ASCII, since it is served with no charset', () => {
    expect(text).not.toMatch(NON_ASCII);
  });
});

describe('public/security-policy.txt', () => {
  const text = read('security-policy.txt');

  it('names the app and its address', () => {
    expect(text.startsWith(`${BRAND_NAME} security policy\n`)).toBe(true);
    expect(text).toContain(BRAND_URL);
  });

  it('says where to report, with the same contact security.txt gives', () => {
    expect(text).toContain(SECURITY_CONTACT.replace('mailto:', ''));
  });

  it('says what to expect, what is in scope and that good faith is safe', () => {
    expect(text).toMatch(/What to expect/);
    expect(text).toMatch(/In scope/);
    expect(text).toMatch(/Out of scope/);
    expect(text).toMatch(/good faith/);
  });

  it('is ASCII, since it is served with no charset', () => {
    expect(text).not.toMatch(NON_ASCII);
  });
});

describe('public/_headers', () => {
  const file = read('_headers');

  it('caches the security policy for a day and lets other sites fetch it', () => {
    const block = file.split('\n/security-policy.txt\n')[1] ?? '';
    expect(block).toContain('Cache-Control: public, max-age=86400');
    expect(block).toContain('Cross-Origin-Resource-Policy: cross-origin');
  });

  it('lets other sites load the icons, and re-checks the service worker every time', () => {
    expect(file.split('\n/icons/*\n')[1] ?? '').toContain(
      'Cross-Origin-Resource-Policy: cross-origin',
    );
    expect(file.split('\n/sw.js\n')[1] ?? '').toContain(
      'Cache-Control: no-cache',
    );
  });
});
