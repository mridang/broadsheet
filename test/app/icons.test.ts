import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { BRAND_NAME } from '../../src/app/_brand';
import { pngIsOpaque, pngSize } from '../png';

const app = (name: string) => path.join(process.cwd(), 'src/app', name);

// The icon and social-image files under src/app are binaries, so one group
// checks them all.
describe('the icon and social images in src/app', () => {
  it('has a favicon.ico holding 16, 32 and 48 pixel images', () => {
    const ico = readFileSync(app('favicon.ico'));
    expect(ico.subarray(0, 6).toString('hex')).toBe('000001000300');
    const entries = [0, 1, 2].map((i) => {
      const at = 6 + i * 16;
      const offset = ico.readUInt32LE(at + 12);
      return {
        width: ico.readUInt8(at),
        height: ico.readUInt8(at + 1),
        length: ico.readUInt32LE(at + 8),
        isPng: ico.subarray(offset, offset + 8).toString('hex'),
        end: offset + ico.readUInt32LE(at + 8),
      };
    });
    expect(entries.map((e) => [e.width, e.height])).toEqual([
      [16, 16],
      [32, 32],
      [48, 48],
    ]);
    expect(entries.map((e) => e.isPng)).toEqual(
      Array(3).fill('89504e470d0a1a0a'),
    );
    expect(entries.at(-1)?.end).toBe(ico.length);
  });

  it('has an apple-icon of 180 pixels with no transparent pixel', async () => {
    expect(pngSize(app('apple-icon.png'))).toEqual({ width: 180, height: 180 });
    expect(pngIsOpaque(app('apple-icon.png'))).toBe(true);
  });

  it.each(['opengraph-image.png', 'twitter-image.png'])(
    'has a %s of 1200 by 630',
    (name) => {
      expect(pngSize(app(name))).toEqual({ width: 1200, height: 630 });
    },
  );

  it('describes the card in the alt text of both social images, which name the app', () => {
    for (const name of ['opengraph-image.alt.txt', 'twitter-image.alt.txt']) {
      expect(readFileSync(app(name), 'utf8')).toContain(BRAND_NAME);
    }
  });

  it('has the same alt text for both social images, as they are the same card', () => {
    expect(readFileSync(app('twitter-image.alt.txt'), 'utf8')).toBe(
      readFileSync(app('opengraph-image.alt.txt'), 'utf8'),
    );
  });

  it('has a scalable icon', () => {
    expect(readFileSync(app('icon.svg'), 'utf8')).toMatch(
      /^<svg [^>]*viewBox=/,
    );
  });
});
