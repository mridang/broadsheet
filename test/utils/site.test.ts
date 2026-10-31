import { describe, expect, it } from '@jest/globals';

import {
  CONTACT_EMAIL,
  PRIVACY_LAST_UPDATED,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
  SOURCE_URL,
  TERMS_LAST_UPDATED,
} from '@/utils/site';

describe('site identity', () => {
  it('gives the site an https address with no trailing slash', () => {
    expect(SITE_URL).toMatch(/^https:\/\/[^/]+$/);
  });

  it('names the site in its address', () => {
    expect(new URL(SITE_URL).hostname.startsWith(`${SITE_NAME}.`)).toBe(true);
  });

  it('gives the site a default title and description', () => {
    expect(SITE_TITLE).not.toBe('');
    expect(SITE_DESCRIPTION).not.toBe('');
  });

  it('gives a contact address for data and terms questions', () => {
    expect(CONTACT_EMAIL).toBe('mridang.agarwalla@gmail.com');
  });

  it.each([PRIVACY_LAST_UPDATED, TERMS_LAST_UPDATED])(
    'dates the legal pages as ISO days (%s)',
    (day) => {
      expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    },
  );
});

describe('the legal pages’ constants', () => {
  it('points to the source on GitHub', () => {
    expect(SOURCE_URL).toBe('https://github.com/mridang/broadsheet');
  });
});
