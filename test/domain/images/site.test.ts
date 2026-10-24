import { describe, expect, it } from '@jest/globals';

import {
  ALLOWED_HOSTS,
  ALLOWED_WIDTHS,
  DEFAULT_WIDTH,
} from '@/domain/images/site';
import { IMG_WIDTH } from '@/domain/render/tiers';

describe('image settings', () => {
  it('takes pictures from any public site, because stories do (the signature is the rule)', () => {
    expect(ALLOWED_HOSTS).toBeNull();
  });

  it('offers the favicon width and the width of each kind of story', () => {
    expect(ALLOWED_WIDTHS).toEqual([64, 480, 600, 800]);
    for (const width of Object.values(IMG_WIDTH)) {
      expect(ALLOWED_WIDTHS).toContain(width);
    }
  });

  it('uses one of the offered widths when none is asked for', () => {
    expect(DEFAULT_WIDTH).toBe(480);
    expect(ALLOWED_WIDTHS).toContain(DEFAULT_WIDTH);
  });
});
