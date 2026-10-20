import { describe, expect, it } from '@jest/globals';

import { GET } from '../../../../src/app/.well-known/security.txt/route';

describe('GET /.well-known/security.txt', () => {
  const res = GET();

  it('answers 200 as plain text in UTF-8', () => {
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it('is re-read daily so the expiry keeps moving ahead', () => {
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
  });

  it('starts with the contact and carries an expiry in the future', async () => {
    const text = await res.clone().text();
    expect(text.startsWith('Contact: mailto:')).toBe(true);
    const expires = /^Expires: (.+)$/m.exec(text)?.[1];
    expect(new Date(expires ?? '').getTime()).toBeGreaterThan(Date.now());
  });
});
