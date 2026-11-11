import { describe, expect, it } from '@jest/globals';

import { decodeEntities } from '@/utils/html-entities';

describe('decodeEntities', () => {
  it('decodes decimal and hexadecimal references', () => {
    expect(
      decodeEntities('Progress on TypeScript 7 &#8211; December 2025'),
    ).toBe('Progress on TypeScript 7 – December 2025');
    expect(decodeEntities('it&#x2019;s &#X2019;')).toBe('it’s ’');
  });

  it('decodes the common named references', () => {
    expect(
      decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;'),
    ).toBe('a & b <c> "d" \'e\'');
    expect(decodeEntities('wait&hellip; &mdash; &ndash; &rsquo;&ldquo;')).toBe(
      'wait… — – ’“',
    );
  });

  it('decodes the symbol references', () => {
    expect(
      decodeEntities(
        '&copy; &reg; &trade; &euro; &rarr; &times; &laquo;&raquo; &bull; &middot; &deg;',
      ),
    ).toBe(
      '\u00A9 \u00AE \u2122 \u20AC \u2192 \u00D7 \u00AB\u00BB \u2022 \u00B7 \u00B0',
    );
  });

  it('leaves unknown and out-of-range references as written', () => {
    expect(decodeEntities('&bogus; &#0; &#1114112; &#xFFFFFFF;')).toBe(
      '&bogus; &#0; &#1114112; &#xFFFFFFF;',
    );
  });

  it('never decodes a decoded ampersand again', () => {
    expect(decodeEntities('&amp;#8211; &amp;lt;')).toBe('&#8211; &lt;');
  });
});
