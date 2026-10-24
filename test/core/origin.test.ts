import { describe, expect, it } from '@jest/globals';

import {
  appOrigin,
  appOriginFromHeaders,
  originOfSetting,
} from '@/core/origin';

describe('without a Cloudflare context (tests, scripts)', () => {
  it("uses the request's own origin as the app origin", () => {
    expect(appOrigin(new Request('http://localhost:3000/a/b?c=d'))).toBe(
      'http://localhost:3000',
    );
  });
});

describe('appOriginFromHeaders', () => {
  it('uses the Host the browser used, and https unless told http', () => {
    expect(
      appOriginFromHeaders(new Headers({ host: 'app.example.test' })),
    ).toBe('https://app.example.test');
    expect(
      appOriginFromHeaders(
        new Headers({ host: 'app.test', 'x-forwarded-proto': 'http' }),
      ),
    ).toBe('http://app.test');
  });

  it('is http on localhost, where there is no TLS', () => {
    expect(appOriginFromHeaders(new Headers({ host: 'localhost:3737' }))).toBe(
      'http://localhost:3737',
    );
  });

  it('ignores a forwarded host that anyone could have sent', () => {
    expect(
      appOriginFromHeaders(
        new Headers({
          host: 'app.example.test',
          'x-forwarded-host': 'evil.example',
        }),
      ),
    ).toBe('https://app.example.test');
  });

  it('ignores a forwarded scheme that is not http or https', () => {
    expect(
      appOriginFromHeaders(
        new Headers({
          host: 'app.example.test',
          'x-forwarded-proto': 'javascript',
        }),
      ),
    ).toBe('https://app.example.test');
  });
});

describe('originOfSetting', () => {
  it('reduces a setting to its origin, so no slash or path ends up in absolute URLs', () => {
    expect(originOfSetting('https://app.example.test')).toBe(
      'https://app.example.test',
    );
    expect(originOfSetting('https://app.example.test/')).toBe(
      'https://app.example.test',
    );
    expect(originOfSetting(' https://app.example.test/app?x=1 ')).toBe(
      'https://app.example.test',
    );
  });

  it('keeps a port and allows http for local use', () => {
    expect(originOfSetting('http://localhost:3737/')).toBe(
      'http://localhost:3737',
    );
  });

  it.each([
    undefined,
    '',
    'not a url',
    'javascript:alert(1)',
    'ftp://example.com',
  ])('ignores %p', (value) => {
    expect(originOfSetting(value)).toBeUndefined();
  });
});
