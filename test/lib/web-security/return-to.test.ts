import { describe, expect, it } from '@jest/globals';

import { safeReturnPath } from '@/lib/web-security';

describe('safeReturnPath', () => {
  it('allows a path on this site, with its query', () => {
    expect(safeReturnPath('/oauth/authorize?client_id=x&state=y')).toBe(
      '/oauth/authorize?client_id=x&state=y',
    );
    expect(safeReturnPath('/app')).toBe('/app');
  });

  it('refuses anything that could leave the site', () => {
    expect(safeReturnPath('https://evil.example')).toBeUndefined();
    expect(safeReturnPath('//evil.example')).toBeUndefined();
    expect(safeReturnPath('/\\evil.example')).toBeUndefined();
    expect(safeReturnPath('javascript:alert(1)')).toBeUndefined();
  });

  it('refuses control characters and empty values', () => {
    expect(safeReturnPath('/a\nb')).toBeUndefined();
    expect(safeReturnPath('')).toBeUndefined();
    expect(safeReturnPath(null)).toBeUndefined();
    expect(safeReturnPath(undefined)).toBeUndefined();
  });
});
