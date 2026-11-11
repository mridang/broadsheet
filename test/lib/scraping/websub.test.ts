import { createHmac, randomUUID } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { signatureMatches, webSubLinks } from '@/lib/scraping';

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
  <link rel="hub" href="https://hub.test/"/>
  <link rel="self" href="https://a.test/feed?x=1&amp;y=2"/>
  <entry><link rel="hub" href="https://wrong.test/"/></entry>
</feed>`;

describe('webSubLinks', () => {
  it('reads the hub and self links of the feed’s header', () => {
    expect(webSubLinks(ATOM, null, 'https://a.test/f')).toEqual({
      hub: 'https://hub.test/',
      self: 'https://a.test/feed?x=1&y=2',
    });
  });

  it('prefers the Link header to the feed', () => {
    expect(
      webSubLinks(
        ATOM,
        '<https://h2.test/>; rel="hub", <https://a.test/s>; rel="self"',
        'https://a.test/f',
      ),
    ).toEqual({ hub: 'https://h2.test/', self: 'https://a.test/s' });
  });

  it('reads RSS atom:link and falls back to the fetched address', () => {
    const rss =
      '<rss><channel><atom:link rel="hub" href="/hub"/><item></item></channel></rss>';
    expect(webSubLinks(rss, null, 'https://a.test/f')).toEqual({
      hub: 'https://a.test/hub',
      self: 'https://a.test/f',
    });
  });

  it('finds nothing in a feed without a hub', () => {
    expect(webSubLinks('<rss></rss>', null, 'https://a.test/f')).toEqual({});
  });

  it('ignores a hub that is not a web address', () => {
    const feed = '<feed><link rel="hub" href="javascript:alert(1)"/></feed>';
    expect(webSubLinks(feed, null, 'https://a.test/f')).toEqual({});
  });
});

describe('signatureMatches', () => {
  const body = new TextEncoder().encode('<feed/>');
  const sharedSecret: string = randomUUID();
  const sign = (method: string, secret = sharedSecret) =>
    `${method}=${createHmac(method, secret).update(body).digest('hex')}`;

  it.each(['sha1', 'sha256', 'sha384', 'sha512'])(
    'accepts a %s signature under the secret',
    async (method) => {
      expect(await signatureMatches(sharedSecret, body, sign(method))).toBe(
        true,
      );
    },
  );

  it.each([
    ['another secret', sign('sha1', 'other')],
    ['no signature', null],
    ['an unknown method', 'md5=00'],
    ['odd hex', 'sha1=abc'],
  ])('refuses %s', async (_, signature) => {
    expect(await signatureMatches(sharedSecret, body, signature)).toBe(false);
  });
});
