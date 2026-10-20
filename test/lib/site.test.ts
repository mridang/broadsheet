import { describe, expect, it } from '@jest/globals';

import { SITE_NAME, SITE_URL } from '../../src/lib/site';

describe('site identity', () => {
  it('names the site and gives its address with no trailing slash', () => {
    expect(SITE_NAME).toBe('broadsheet');
    expect(SITE_URL).toBe('https://broadsheet.apps.mrida.ng');
  });
});
