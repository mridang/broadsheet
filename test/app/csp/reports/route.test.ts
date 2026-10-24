import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { POST } from '@/app/csp/reports/route';

let logged: unknown[][];

beforeEach(() => {
  logged = [];
  jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const send = (body: BodyInit, contentType = 'application/reports+json') =>
  POST(
    new Request('https://app.test/csp/reports', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    }),
  );

const report = JSON.stringify([
  {
    type: 'csp-violation',
    body: {
      documentURL: 'https://app.test/app',
      blockedURL: 'https://evil.test/x.js',
      effectiveDirective: 'script-src-elem',
    },
  },
]);

describe('POST /csp/reports', () => {
  it('answers 204 and logs one structured line for a report', async () => {
    const res = await send(report);
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(logged).toHaveLength(1);
    expect(logged[0]?.[0]).toBe('[csp-report]');
    expect(JSON.parse(String(logged[0]?.[1]))).toMatchObject({
      page: '/app',
      blocked: 'https://evil.test',
      directive: 'script-src-elem',
    });
  });

  it('takes the older format as well', async () => {
    const res = await send(
      JSON.stringify({
        'csp-report': {
          'blocked-uri': 'inline',
          'violated-directive': 'script-src',
        },
      }),
      'application/csp-report',
    );
    expect(res.status).toBe(204);
    expect(logged).toHaveLength(1);
  });

  it('answers 204 and logs nothing for a report an extension caused', async () => {
    const res = await send(
      JSON.stringify([
        {
          type: 'csp-violation',
          body: { blockedURL: 'chrome-extension://abc/x.js' },
        },
      ]),
    );
    expect(res.status).toBe(204);
    expect(logged).toEqual([]);
  });

  it('answers 400 to text that is not JSON', async () => {
    expect((await send('{nope')).status).toBe(400);
    expect(logged).toEqual([]);
  });

  it('answers 413 to a body over 16 KiB, without logging it', async () => {
    expect((await send('x'.repeat(20_000))).status).toBe(413);
    expect(logged).toEqual([]);
  });
});
