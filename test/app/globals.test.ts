import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

const CURSOR_PATTERN = /(button:not\(:disabled\),[^{]*)\{\s*cursor: pointer;/;
const IS_LEFT_ALONE_FOR_PATTERN = /(^|,)\s*button,/;
const DRAWS_ITS_OWN_CHEVRON_PATTERN =
  /select:not\(\[multiple\]\):not\(\[size\]\) \{\s*appearance: none;\s*padding-right: 2\.25rem;\s*background-image: url\("data:image\/svg\+xml/;
const GIVES_TEXT_BOXES_SELECTS_PATTERN =
  /select,\s*textarea \{\s*min-height: 2\.5rem;\s*border: 1px solid var\(--color-field\)/;

const css = await readFile(
  path.join(process.cwd(), 'src', 'app', 'globals.css'),
  'utf8',
);

describe('globals.css', () => {
  describe('cursor', () => {
    const rule = CURSOR_PATTERN.exec(css)?.[1];

    it('is the pointer for anything clickable, since Tailwind 4 no longer gives buttons one', () => {
      for (const selector of [
        'button:not(:disabled)',
        'summary',
        'select:not(:disabled)',
      ])
        expect(rule).toContain(selector);
      expect(rule).toContain("[role='button']");
    });

    it('is left alone for disabled controls', () => {
      expect(rule).not.toMatch(IS_LEFT_ALONE_FOR_PATTERN);
      expect(rule).toContain(':not(:disabled)');
    });
  });
});

describe('globals.css form controls', () => {
  const forms = css.slice(css.indexOf('/* Form controls.'));

  it('draws its own chevron into every select, with room for it', () => {
    expect(forms).toMatch(DRAWS_ITS_OWN_CHEVRON_PATTERN);
    expect(forms).toContain('background-position: right 0.75rem center');
  });

  it('beats Tailwind’s reset, which a zero-specificity selector would lose to', () => {
    expect(forms).not.toContain(':where(');
  });

  it('gives text boxes, selects and text areas one field look', () => {
    expect(forms).toMatch(GIVES_TEXT_BOXES_SELECTS_PATTERN);
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
    for (const selector of ['button', 'dialog'])
      expect(print).toContain(selector);
    expect(print).toContain('display: none');
  });
});
