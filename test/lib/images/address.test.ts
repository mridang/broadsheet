import { describe, expect, it } from '@jest/globals';

import {
  IMAGE_PATH,
  imageSrc,
  imageSrcSet,
  isAllowedHost,
  isProxyableUrl,
  snapWidth,
} from '../../../src/lib/images/address';
import { ALLOWED_HOSTS, ALLOWED_WIDTHS } from '../../../src/lib/images/site';

/** A host the app takes pictures from. */
const HOST = ALLOWED_HOSTS?.[0] ?? 'photos.example.org';

/** Hosts the app does not take pictures from (none, when it takes them from anywhere). */
const OTHER_HOSTS = ALLOWED_HOSTS === null ? [] : ['evil.example.org'];

const SMALLEST = Math.min(...ALLOWED_WIDTHS);
const LARGEST = Math.max(...ALLOWED_WIDTHS);

describe('snapWidth', () => {
  it('snaps a width up to one the app offers', () => {
    expect(snapWidth(1)).toBe(SMALLEST);
    for (const width of ALLOWED_WIDTHS) {
      expect(snapWidth(width)).toBe(width);
    }
  });

  it('uses the largest width for anything wider', () => {
    expect(snapWidth(LARGEST + 1)).toBe(LARGEST);
    expect(snapWidth(100_000)).toBe(LARGEST);
  });

  it('always answers a width the app offers', () => {
    for (const width of [1, 100, 321, 481, 777, 1281, 5000]) {
      expect(ALLOWED_WIDTHS).toContain(snapWidth(width));
    }
  });
});

describe('imageSrc', () => {
  it('builds our own address for a picture, at a snapped width', () => {
    expect(imageSrc(`https://${HOST}/x y.jpg?v=1&w=2`, 1)).toBe(
      `${IMAGE_PATH}?url=${encodeURIComponent(`https://${HOST}/x y.jpg?v=1&w=2`)}&w=${SMALLEST}`,
    );
  });

  it('serves the picture from /img', () => {
    expect(IMAGE_PATH).toBe('/img');
  });

  it('adds the signature when it is given one', () => {
    expect(imageSrc(`https://${HOST}/x.jpg`, SMALLEST, 'a+b/c')).toContain(
      '&sig=a%2Bb%2Fc',
    );
    expect(imageSrc(`https://${HOST}/x.jpg`, SMALLEST)).not.toContain('sig=');
  });
});

describe('imageSrcSet', () => {
  it('builds a srcset with each width', () => {
    const set = imageSrcSet(`https://${HOST}/x.jpg`);
    for (const width of ALLOWED_WIDTHS) {
      expect(set).toContain(`&w=${width} ${width}w`);
    }
  });

  it('builds one for just the widths asked for', () => {
    const set = imageSrcSet(`https://${HOST}/x.jpg`, [LARGEST], 'sig');
    expect(set).toBe(
      `${imageSrc(`https://${HOST}/x.jpg`, LARGEST, 'sig')} ${LARGEST}w`,
    );
  });
});

describe('isAllowedHost', () => {
  it('accepts the hosts the app takes pictures from', () => {
    expect(isAllowedHost(`https://${HOST}/a.jpg`)).toBe(true);
    expect(isAllowedHost(`https://${HOST.toUpperCase()}/a.jpg`)).toBe(true);
  });

  it('refuses any other host, where the app names the hosts it takes pictures from', () => {
    for (const host of OTHER_HOSTS) {
      expect(isAllowedHost(`https://${host}/a.jpg`)).toBe(false);
    }
  });

  it('refuses something that is not an address', () => {
    expect(isAllowedHost('not a url')).toBe(false);
  });
});

describe('isProxyableUrl', () => {
  it.each([
    `https://${HOST}/wp-content/uploads/a.jpg`,
    `http://${HOST}/a.png`,
    `https://${HOST}:443/a.webp`,
  ])('accepts %s', (url) => {
    expect(isProxyableUrl(url)).toBe(true);
  });

  it.each([
    'file:///etc/passwd',
    'ftp://a.com/x.jpg',
    'javascript:alert(1)',
    'https://localhost/x.jpg',
    'http://127.0.0.1/x.jpg',
    'http://10.0.0.5/x.jpg',
    'http://192.168.1.1/x.jpg',
    'http://172.20.0.1/x.jpg',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/x.jpg',
    'http://2130706433/x.jpg',
    'https://localhost./x.jpg',
    'https://printer.local./x.jpg',
    'https://intranet/x.jpg',
    'https://printer.local/x.jpg',
    'https://a.com:8080/x.jpg',
    'https://user:pw@a.com/x.jpg',
    'not a url',
    '',
    ...OTHER_HOSTS.map((host) => `https://${host}/a.jpg`),
  ])('refuses %s', (url) => {
    expect(isProxyableUrl(url)).toBe(false);
  });
});
