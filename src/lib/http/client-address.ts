/**
 * @packageDocumentation
 *
 * Who a request comes from, as a rate-limit subject. Behind Cloudflare the
 * caller's address is in `CF-Connecting-IP`. An IPv6 address is reduced to its
 * /64 prefix, because one home or office network is handed a whole /64 and a
 * caller could otherwise rotate through 2^64 addresses to get a fresh counter
 * on every request.
 */

/** The subject used when no header names a caller (local development). */
export const UNKNOWN_ADDRESS = 'unknown';

/**
 * Expand an IPv6 address into its eight 16-bit groups, or undefined if it is not
 * one. Handles `::` compression and an embedded IPv4 tail; a zone id (`%eth0`)
 * is ignored.
 */
function ipv6Groups(address: string): readonly number[] | undefined {
  const bare = address.split('%')[0]?.toLowerCase() ?? '';
  if (!bare.includes(':')) {
    return undefined;
  }
  const [head = '', tail, ...extra] = bare.split('::');
  if (extra.length > 0) {
    return undefined;
  }
  const words = (part: string): readonly string[] | undefined => {
    const pieces = part === '' ? [] : part.split(':');
    const last = pieces.at(-1) ?? '';
    if (!last.includes('.')) {
      return pieces;
    }
    const octets = last.split('.').map(Number);
    if (
      octets.length !== 4 ||
      octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)
    ) {
      return undefined;
    }
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    return [
      ...pieces.slice(0, -1),
      ((a << 8) | b).toString(16),
      ((c << 8) | d).toString(16),
    ];
  };
  const before = words(head);
  const after = tail === undefined ? [] : words(tail);
  if (!before || !after) {
    return undefined;
  }
  const missing = 8 - before.length - after.length;
  if (
    (tail === undefined && missing !== 0) ||
    missing < (tail === undefined ? 0 : 1)
  ) {
    return undefined;
  }
  const groups = [
    ...before,
    ...Array.from({ length: missing }, () => '0'),
    ...after,
  ].map((group) =>
    /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN,
  );
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g))
    ? groups
    : undefined;
}

/**
 * The part of an address that identifies one network for rate-limiting: an
 * IPv4 address as it is, an IPv6 address as its /64 prefix (`2001:db8:1:2::/64`),
 * anything else unchanged.
 */
export function addressSubject(address: string): string {
  const groups = ipv6Groups(address);
  return groups
    ? `${groups
        .slice(0, 4)
        .map((g) => g.toString(16))
        .join(':')}::/64`
    : address;
}

/**
 * The rate-limit subject of a request's caller: Cloudflare's connecting
 * address, else the first hop of `X-Forwarded-For`, else {@link UNKNOWN_ADDRESS},
 * with IPv6 reduced to its /64 (see {@link addressSubject}).
 */
export function clientSubject(headers: Headers): string {
  const cloudflare = headers.get('cf-connecting-ip')?.trim();
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const address = cloudflare || forwarded;
  return address ? addressSubject(address) : UNKNOWN_ADDRESS;
}
