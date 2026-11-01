import { describe, expect, it } from '@jest/globals';

import { Menu, MenuDivider, MenuItem, MenuLabel } from '@/components/ui/menu';
import { html } from '../render';

describe('Menu', () => {
  const out = html(
    <Menu trigger="⋯" triggerClassName="chip" label="More actions">
      <MenuLabel>Story</MenuLabel>
      <MenuItem>Share</MenuItem>
      <MenuDivider />
      <MenuItem disabled>Queue</MenuItem>
    </Menu>,
  );

  it('is a disclosure that works before the script loads', () => {
    expect(out).toMatch(/^<details/);
    expect(out).toContain('<summary aria-label="More actions"');
  });

  it('holds buttons that never submit a form', () => {
    expect(out.match(/type="button"/g)).toHaveLength(2);
  });

  it('becomes a sheet along the bottom on a phone', () => {
    expect(out).toContain('fixed inset-x-0 bottom-0');
    expect(out).toContain('sm:absolute');
  });
});
