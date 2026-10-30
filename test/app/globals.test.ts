import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

const css = readFileSync(
  join(process.cwd(), 'src', 'app', 'globals.css'),
  'utf8',
);

describe('globals.css', () => {
  describe('cursor', () => {
    const rule = /(button:not\(:disabled\),[^{]*)\{\s*cursor: pointer;/.exec(
      css,
    )?.[1];

    it('is the pointer for anything clickable, since Tailwind 4 no longer gives buttons one', () => {
      ['button:not(:disabled)', 'summary', 'select:not(:disabled)'].forEach(
        (selector) => expect(rule).toContain(selector),
      );
      expect(rule).toContain("[role='button']");
    });

    it('is left alone for disabled controls', () => {
      expect(rule).not.toMatch(/(^|,)\s*button,/);
      expect(rule).toContain(':not(:disabled)');
    });
  });
});
