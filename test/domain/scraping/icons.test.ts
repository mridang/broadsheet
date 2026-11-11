import { describe, expect, it } from '@jest/globals';

import {
  firstWorkingIcon,
  iconCandidates,
  manifestIcons,
  manifestUrl,
  pageIcons,
} from '@/domain/scraping/icons';

const BASE = 'https://site.test/blog/';

describe('pageIcons', () => {
  it('lists icon and apple-touch-icon links, largest first, made absolute', () => {
    const html = `<head>
      <link rel="icon" href="/f16.png" sizes="16x16">
      <link rel="shortcut icon" href="f.ico">
      <link rel="apple-touch-icon" href="/touch.png">
      <link rel="icon" type="image/svg+xml" href="/logo.svg" sizes="any">
      <link rel="stylesheet" href="/s.css">
      <link rel="icon" href="javascript:alert(1)">
    </head>`;
    expect(pageIcons(html, BASE)).toEqual([
      'https://site.test/logo.svg',
      'https://site.test/touch.png',
      'https://site.test/f16.png',
      'https://site.test/blog/f.ico',
    ]);
  });
});

describe('manifestUrl and manifestIcons', () => {
  it('finds the manifest and its icons, largest first', () => {
    expect(
      manifestUrl('<link rel="manifest" href="/app.webmanifest">', BASE),
    ).toBe('https://site.test/app.webmanifest');
    expect(
      manifestUrl('<link rel="icon" href="/i.png">', BASE),
    ).toBeUndefined();
    expect(
      manifestIcons(
        JSON.stringify({
          icons: [
            { src: 'i192.png', sizes: '192x192' },
            { src: '/i512.png', sizes: '512x512' },
            { nope: true },
          ],
        }),
        'https://site.test/app.webmanifest',
      ),
    ).toEqual(['https://site.test/i512.png', 'https://site.test/i192.png']);
  });

  it('reads nothing from a manifest that is not JSON or has no icons', () => {
    expect(manifestIcons('<html>', BASE)).toEqual([]);
    expect(manifestIcons('{"name":"x"}', BASE)).toEqual([]);
  });
});

describe('iconCandidates', () => {
  it('tries the page, the manifest, the feed image, then /favicon.ico, once each', () => {
    expect(
      iconCandidates({
        page: ['https://site.test/a.png'],
        manifest: ['https://site.test/b.png', 'https://site.test/a.png'],
        feed: 'https://cdn.test/feed.png',
        site: BASE,
      }),
    ).toEqual([
      'https://site.test/a.png',
      'https://site.test/b.png',
      'https://cdn.test/feed.png',
      'https://site.test/favicon.ico',
    ]);
  });
});

describe('firstWorkingIcon', () => {
  const answers: Record<string, Response | Error> = {
    'https://x.test/missing.png': new Response(null, { status: 404 }),
    'https://x.test/page.png': new Response('<html>', {
      headers: { 'content-type': 'text/html' },
    }),
    'https://x.test/down.png': new Error('offline'),
    'https://x.test/good.png': new Response('png', {
      headers: { 'content-type': 'image/png' },
    }),
  };
  const fetcher = async (url: string) => {
    const answer = answers[url];
    if (!answer || answer instanceof Error) throw answer ?? new Error('none');
    return answer;
  };

  it('skips what is missing, not an image or unreachable', async () => {
    expect(
      await firstWorkingIcon(
        [
          'https://x.test/missing.png',
          'https://x.test/page.png',
          'https://x.test/down.png',
          'https://x.test/good.png',
        ],
        fetcher,
      ),
    ).toBe('https://x.test/good.png');
  });

  it('is blank when nothing works', async () => {
    expect(
      await firstWorkingIcon(['https://x.test/missing2.png'], fetcher),
    ).toBe('');
  });
});

describe('pageIcons sizes', () => {
  it('reads each WxH pair once, without chaining', () => {
    const html = `<head>
      <link rel="icon" href="/chained.png" sizes="8x8x100">
      <link rel="icon" href="/ten.png" sizes="10x10">
      <link rel="icon" href="/two.png" sizes="16x16 64X32">
      <link rel="icon" href="/mid.png" sizes="48x48">
    </head>`;
    expect(pageIcons(html, BASE)).toEqual([
      'https://site.test/two.png',
      'https://site.test/mid.png',
      'https://site.test/ten.png',
      'https://site.test/chained.png',
    ]);
  });
});
