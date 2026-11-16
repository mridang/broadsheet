import { describe, expect, it } from '@jest/globals';

import { Menu, MenuDivider, MenuItem, MenuLabel } from '@/components/ui/menu';
import { html } from '../render';

const IS_A_BUTTON_THAT_PATTERN =
  /<button type="button" aria-label="More actions" aria-expanded="false"[^>]*class="chip"/;
const IS_A_BUTTON_THAT_PATTERN_2 = /<div[^>]*popover="auto" data-popover=""/;
const GIVES_ITS_PANEL_THE_PATTERN =
  /data-popover=""[^>]*class="[^"]*overflow-y-auto[^"]*w-72/;
const PUTS_THE_CALLER_S_CLASSES_PATTERN = /^<div class="print:hidden">/;
const IS_A_BUTTON_THAT_PATTERN_3 = /^<button type="button"/;
const IS_A_HAIRLINE_PATTERN = /^<hr class="[^"]*border-line/;

describe('Menu', () => {
  const out = html(
    <Menu
      trigger="⋯"
      triggerClassName="chip"
      label="More actions"
      width="w-72"
      className="print:hidden"
    >
      <MenuItem>Share</MenuItem>
    </Menu>,
  );

  it('is a button that opens a popover in the top layer', () => {
    expect(out).toMatch(IS_A_BUTTON_THAT_PATTERN);
    expect(out).toMatch(IS_A_BUTTON_THAT_PATTERN_2);
  });

  it('keeps its items out of the page until it is opened', () => {
    expect(out).not.toContain('Share');
  });

  it('gives its panel the width asked for, scrolling when it is tall', () => {
    expect(out).toMatch(GIVES_ITS_PANEL_THE_PATTERN);
  });

  it('puts the caller’s classes on its wrapper', () => {
    expect(out).toMatch(PUTS_THE_CALLER_S_CLASSES_PATTERN);
  });
});

describe('MenuItem', () => {
  it('is a button that never submits a form', () => {
    expect(html(<MenuItem>Queue</MenuItem>)).toMatch(
      IS_A_BUTTON_THAT_PATTERN_3,
    );
  });
});

describe('MenuDivider', () => {
  it('is a hairline', () => {
    expect(html(<MenuDivider />)).toMatch(IS_A_HAIRLINE_PATTERN);
  });
});

describe('MenuLabel', () => {
  it('is a small caption', () => {
    expect(html(<MenuLabel>Story</MenuLabel>)).toContain('Story');
  });
});
