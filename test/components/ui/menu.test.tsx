import { describe, expect, it } from '@jest/globals';

import { Menu, MenuDivider, MenuItem, MenuLabel } from '@/components/ui/menu';
import { html } from '../render';

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
    expect(out).toMatch(
      /<button type="button" aria-label="More actions" aria-expanded="false"[^>]*class="chip"/,
    );
    expect(out).toMatch(/<div[^>]*popover="auto" data-popover=""/);
  });

  it('keeps its items out of the page until it is opened', () => {
    expect(out).not.toContain('Share');
  });

  it('gives its panel the width asked for, scrolling when it is tall', () => {
    expect(out).toMatch(
      /data-popover=""[^>]*class="[^"]*overflow-y-auto[^"]*w-72/,
    );
  });

  it('puts the caller’s classes on its wrapper', () => {
    expect(out).toMatch(/^<div class="print:hidden">/);
  });
});

describe('MenuItem', () => {
  it('is a button that never submits a form', () => {
    expect(html(<MenuItem>Queue</MenuItem>)).toMatch(/^<button type="button"/);
  });
});

describe('MenuDivider', () => {
  it('is a hairline', () => {
    expect(html(<MenuDivider />)).toMatch(/^<hr class="[^"]*border-line/);
  });
});

describe('MenuLabel', () => {
  it('is a small caption', () => {
    expect(html(<MenuLabel>Story</MenuLabel>)).toContain('Story');
  });
});
