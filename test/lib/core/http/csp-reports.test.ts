import { describe, expect, it } from '@jest/globals';

import { MAX_REPORTS_PER_REQUEST, summariseReports } from '@/lib/core/http';

/** A Reporting API report. */
const modern = (body: Record<string, unknown>, type = 'csp-violation') => ({
  type,
  url: 'https://app.test/app',
  body,
});

describe('summariseReports', () => {
  it('reads a Reporting API report, keeping the page path and dropping its query', () => {
    expect(
      summariseReports([
        modern({
          documentURL: 'https://app.test/recipe/abc?q=secret#frag',
          blockedURL: 'https://evil.test/x.js?token=1',
          effectiveDirective: 'script-src-elem',
          disposition: 'enforce',
          sample: 'alert(1)',
          sourceFile: 'https://app.test/_next/static/a.js?v=2',
          lineNumber: 12,
        }),
      ]),
    ).toEqual([
      {
        type: 'csp-violation',
        page: '/recipe/abc',
        blocked: 'https://evil.test',
        directive: 'script-src-elem',
        disposition: 'enforce',
        sample: 'alert(1)',
        source: '/_next/static/a.js:12',
      },
    ]);
  });

  it('reads the older single-report format', () => {
    const [report] = summariseReports({
      'csp-report': {
        'document-uri': 'https://app.test/',
        'blocked-uri': 'inline',
        'violated-directive': 'script-src',
        'effective-directive': 'script-src-elem',
        disposition: 'report',
        'script-sample': 'var a',
        'source-file': 'https://app.test/',
        'line-number': 3,
      },
    });
    expect(report).toMatchObject({
      type: 'csp-violation',
      page: '/',
      blocked: 'inline',
      directive: 'script-src-elem',
      disposition: 'report',
      sample: 'var a',
    });
  });

  it('keeps the keyword for an inline, eval or Trusted Types block', () => {
    const blocked = ['inline', 'eval', 'trusted-types-sink'].map(
      (blockedURL) => summariseReports([modern({ blockedURL })])[0]?.blocked,
    );
    expect(blocked).toEqual(['inline', 'eval', 'trusted-types-sink']);
  });

  it('keeps the type of a report that is not about the CSP', () => {
    expect(
      summariseReports([modern({ message: 'x' }, 'deprecation')])[0]?.type,
    ).toBe('deprecation');
  });

  it.each([
    'chrome-extension://abc/inject.js',
    'moz-extension://abc/inject.js',
    'safari-extension://abc/inject.js',
    'safari-web-extension://abc/inject.js',
  ])('leaves out a report caused by %s', (address) => {
    expect(summariseReports([modern({ blockedURL: address })])).toEqual([]);
    expect(summariseReports([modern({ sourceFile: address })])).toEqual([]);
  });

  it('keeps the other reports in a batch that has an extension one in it', () => {
    expect(
      summariseReports([
        modern({ blockedURL: 'chrome-extension://abc/x.js' }),
        modern({ blockedURL: 'https://evil.test/x.js' }),
      ]),
    ).toHaveLength(1);
  });

  it('takes at most a fixed number from one request', () => {
    const many = Array.from({ length: 500 }, () =>
      modern({ blockedURL: 'inline' }),
    );
    expect(summariseReports(many)).toHaveLength(MAX_REPORTS_PER_REQUEST);
  });

  it('cuts every field short and strips control characters, so nothing can forge a log line', () => {
    const [report] = summariseReports([
      modern({
        sample: `${'x'.repeat(500)}\n[csp-report] {"forged":true}`,
        effectiveDirective: `a${'b'.repeat(200)}`,
        blockedURL: 'not a url\r\nforged',
      }),
    ]);
    expect(report?.sample).toHaveLength(80);
    expect(report?.directive).toHaveLength(60);
    expect(report?.blocked).not.toMatch(/[\r\n]/);
    expect(JSON.stringify(report)).not.toContain('\\n');
  });

  it.each([
    null,
    undefined,
    'text',
    7,
    {},
    [],
    [null],
    [{}],
    [{ body: 'x' }],
    { 'csp-report': 'x' },
  ])('ignores %p, which is not a report', (body) => {
    expect(summariseReports(body)).toEqual([]);
  });

  it('ignores a field of the wrong type instead of failing', () => {
    expect(
      summariseReports([
        modern({ blockedURL: 5, documentURL: { a: 1 }, lineNumber: 'x' }),
      ]),
    ).toHaveLength(1);
  });
});
