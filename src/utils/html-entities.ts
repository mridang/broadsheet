/** Named references feeds use for punctuation; numeric ones are decoded for any code point. */
const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '\u2022',
  middot: '\u00b7',
  laquo: '\u00ab',
  raquo: '\u00bb',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  times: '\u00d7',
  deg: '\u00b0',
  euro: '\u20ac',
  larr: '\u2190',
  rarr: '\u2192',
};

/**
 * Decode character references in one pass: numeric (`&#8211;`, `&#x2013;`)
 * and the common named ones. An unknown or out-of-range reference is left as
 * written, and a decoded `&` is never decoded again (`&amp;#8211;` stays
 * `&#8211;`).
 */
export function decodeEntities(s: string): string {
  return s.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (whole, dec?: string, hex?: string, name?: string) => {
      if (name) return NAMED[name.toLowerCase()] ?? whole;
      const n = dec !== undefined ? Number(dec) : parseInt(hex ?? '', 16);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    },
  );
}
