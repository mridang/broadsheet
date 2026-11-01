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

describe('globals.css form controls', () => {
  const forms = css.slice(css.indexOf('/* Form controls.'));

  it('draws its own chevron into every select, with room for it', () => {
    expect(forms).toMatch(
      /select:not\(\[multiple\]\):not\(\[size\]\) \{\s*appearance: none;\s*padding-right: 2\.25rem;\s*background-image: url\("data:image\/svg\+xml/,
    );
    expect(forms).toContain('background-position: right 0.75rem center');
  });

  it('beats Tailwind’s reset, which a zero-specificity selector would lose to', () => {
    expect(forms).not.toContain(':where(');
  });

  it('gives text boxes, selects and text areas one field look', () => {
    expect(forms).toMatch(
      /select,\s*textarea \{\s*min-height: 2\.5rem;\s*border: 1px solid var\(--color-field\)/,
    );
  });

  it('tints tick boxes and radios with the accent, but not the switch', () => {
    expect(forms).toContain(
      "input:is([type='checkbox'], [type='radio']):not([role='switch'])",
    );
    expect(forms).toContain('accent-color: var(--color-accent)');
  });
});

describe('globals.css popovers', () => {
  it('anchors an open popover under its button, in the top layer', () => {
    expect(css).toContain('[popovertarget]:has(+ [data-popover]:popover-open)');
    expect(css).toContain('position-area: bottom span-left');
  });
});

describe('globals.css print', () => {
  const print = css.slice(css.lastIndexOf('@media print'));

  it('leaves every control and dialog off the printout', () => {
    ['button', 'dialog'].forEach((selector) =>
      expect(print).toContain(selector),
    );
    expect(print).toContain('display: none');
  });
});
