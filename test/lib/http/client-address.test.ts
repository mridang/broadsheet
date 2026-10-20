import { describe, expect, it } from '@jest/globals';

import {
  UNKNOWN_ADDRESS,
  addressSubject,
  clientSubject,
} from '../../../src/lib/http/client-address';

describe('addressSubject', () => {
  it('leaves an IPv4 address as it is', () => {
    expect(addressSubject('203.0.113.7')).toBe('203.0.113.7');
  });

  it('reduces an IPv6 address to its /64', () => {
    expect(addressSubject('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
  });

  it('gives every address in one /64 the same subject', () => {
    expect(addressSubject('2001:db8:1:2::1')).toBe(
      addressSubject('2001:db8:1:2:ffff:ffff:ffff:ffff'),
    );
  });

  it('tells two /64s apart', () => {
    expect(addressSubject('2001:db8:1:2::1')).not.toBe(
      addressSubject('2001:db8:1:3::1'),
    );
  });

  it.each([
    ['::1', '0:0:0:0::/64'],
    ['2001:DB8::', '2001:db8:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['::ffff:192.0.2.1', '0:0:0:0::/64'],
    ['2001:db8::1:2', '2001:db8:0:0::/64'],
  ])('reads %s', (address, subject) => {
    expect(addressSubject(address)).toBe(subject);
  });

  it.each([
    'not-an-address',
    'a:b:c',
    '1:2:3:4:5:6:7:8:9',
    '::g',
    '1::2::3',
    '',
  ])('leaves %p alone, since it is no IPv6 address', (value) => {
    expect(addressSubject(value)).toBe(value);
  });
});

describe('clientSubject', () => {
  const from = (headers: Record<string, string>) => new Headers(headers);

  it("prefers Cloudflare's connecting address", () => {
    expect(
      clientSubject(
        from({
          'cf-connecting-ip': '203.0.113.7',
          'x-forwarded-for': '1.1.1.1',
        }),
      ),
    ).toBe('203.0.113.7');
  });

  it('falls back to the first X-Forwarded-For hop', () => {
    expect(
      clientSubject(from({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1' })),
    ).toBe('198.51.100.9');
  });

  it('aggregates an IPv6 caller to the /64', () => {
    expect(clientSubject(from({ 'cf-connecting-ip': '2001:db8:1:2::9' }))).toBe(
      '2001:db8:1:2::/64',
    );
  });

  it('shares one subject when no header names a caller', () => {
    expect(clientSubject(from({}))).toBe(UNKNOWN_ADDRESS);
  });
});
