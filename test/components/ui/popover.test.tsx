import { describe, expect, it, jest } from '@jest/globals';

import {
  Popover,
  PopoverLabel,
  PopoverSeparator,
  PopoverStatus,
  applyPlacement,
  escapeHandler,
  fallbackPlacement,
  focusLeft,
  isOpenOn,
  supportsAnchorPositioning,
  supportsPopover,
} from '@/components/ui/popover';
import { html, htmlAt } from '../render';

describe('PopoverSeparator', () => {
  it('is a thin rule that assistive technology knows is a separator', () => {
    const out = html(<PopoverSeparator />);
    expect(out).toContain('role="separator"');
    expect(out).toContain('h-px');
  });
});

describe('PopoverLabel', () => {
  it('shows a small caption over the value, and keeps a long value to one line', () => {
    const out = html(
      <PopoverLabel caption="Signed in as">ada@example.com</PopoverLabel>,
    );
    expect(out.indexOf('Signed in as')).toBeLessThan(
      out.indexOf('ada@example.com'),
    );
    expect(out).toContain('truncate');
  });
});

describe('Popover', () => {
  const out = html(
    <Popover label="Menu" button="Open" panelClassName="w-64">
      <a href="/x">Inside</a>
    </Popover>,
  );
  const panelId = /id="([^"]+)" popover="auto"/.exec(out)?.[1];

  it('is a button that says the panel is closed, named for what it opens', () => {
    expect(out).toMatch(/<button[^>]*aria-label="Menu"[^>]*>Open<\/button>/);
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('data-state="closed"');
  });

  it('ties the button to the panel for assistive technology, but does not let the browser open it before React is listening', () => {
    expect(panelId).toBeDefined();
    expect(out).toContain(`aria-controls="${panelId}"`);
    expect(out).not.toMatch(/popovertarget/i);
  });

  it('keeps the panel in the page as a popover the browser hides until it is opened', () => {
    expect(out).toMatch(/<div[^>]*popover="auto"[^>]*data-popover=""/);
  });

  it('keeps what is inside the panel out of the page until it is opened', () => {
    expect(out).not.toContain('Inside');
  });

  it('is not marked open for the no-popover fallback until it is', () => {
    expect(out).not.toContain('data-open');
  });

  it('draws the panel as a bordered card, with the caller’s classes, and leaves its position to the stylesheet', () => {
    expect(out).toContain('rounded-card');
    expect(out).toContain('w-64');
    expect(out).not.toContain('absolute');
    expect(out).not.toContain('top-full');
  });
});

describe('supportsPopover', () => {
  it('is true for an element in a browser that has the Popover API', () => {
    expect(supportsPopover(Object.create({ popover: null }))).toBe(true);
  });

  it('is false in a browser that does not, so the component shows the panel itself', () => {
    expect(supportsPopover(Object.create({ hidden: false }))).toBe(false);
  });
});

describe('supportsAnchorPositioning', () => {
  it('asks the browser whether it understands position-area', () => {
    const supports = jest.fn<(property: string, value: string) => boolean>(
      () => true,
    );
    expect(supportsAnchorPositioning({ supports })).toBe(true);
    expect(supports).toHaveBeenCalledWith('position-area', 'bottom');
  });

  it('is false when the browser says no', () => {
    expect(supportsAnchorPositioning({ supports: () => false })).toBe(false);
  });
});

describe('fallbackPlacement', () => {
  it('puts the panel just under the button with their right edges together', () => {
    expect(fallbackPlacement({ bottom: 48, right: 980 }, 1000)).toEqual({
      top: 56,
      right: 20,
    });
  });

  it('keeps a margin when the button touches the window’s edge', () => {
    expect(fallbackPlacement({ bottom: 40, right: 1000 }, 1000)).toEqual({
      top: 48,
      right: 8,
    });
  });
});

describe('applyPlacement', () => {
  it('hands the stylesheet the two custom properties it reads, in pixels', () => {
    const set = jest.fn();
    applyPlacement({ setProperty: set }, { top: 56, right: 20 });
    expect(set).toHaveBeenCalledWith('--popover-top', '56px');
    expect(set).toHaveBeenCalledWith('--popover-right', '20px');
  });
});

describe('focusLeft', () => {
  // Stand-ins for DOM nodes: all `focusLeft` asks of them is identity.
  const inside = { id: 'inside' } as unknown as Node;
  const outside = { id: 'outside' } as unknown as Node;
  const root = { contains: (node: Node | null) => node === inside };

  it('is true when focus moves to something outside the popover', () => {
    expect(focusLeft(root, outside)).toBe(true);
  });

  it('is false while focus stays within it (button to item, item to item)', () => {
    expect(focusLeft(root, inside)).toBe(false);
  });

  it('is false when focus goes nowhere, such as the window losing focus', () => {
    expect(focusLeft(root, null)).toBe(false);
  });
});

describe('isOpenOn', () => {
  it('is open on the page it was opened on', () => {
    expect(isOpenOn({ pathname: '/app' }, '/app')).toBe(true);
  });

  it('is closed once the page has changed', () => {
    expect(isOpenOn({ pathname: '/app' }, '/connect')).toBe(false);
  });

  it('is closed when it was never opened', () => {
    expect(isOpenOn(null, '/app')).toBe(false);
  });
});

describe('PopoverStatus', () => {
  it('is plain text that is announced politely, not a button', () => {
    const out = html(<PopoverStatus>Google Drive connected</PopoverStatus>);
    expect(out).toMatch(/^<p role="status"[^>]*>Google Drive connected<\/p>$/);
    expect(out).not.toContain('<button');
    expect(out).not.toContain('disabled');
  });
});

describe('Popover inside the app', () => {
  it('renders closed on any page', () => {
    const out = htmlAt(
      <Popover label="Menu" button="Open">
        <a href="/x">Inside</a>
      </Popover>,
      { pathname: '/app' },
    );
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('popover="auto"');
  });
});

describe('escapeHandler', () => {
  it('closes the panel and puts focus back on the button for Escape', () => {
    const close = jest.fn();
    const focusButton = jest.fn();
    escapeHandler(close, focusButton)({ key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    expect(focusButton).toHaveBeenCalledTimes(1);
  });

  it('leaves every other key to whatever has focus', () => {
    const close = jest.fn();
    const focusButton = jest.fn();
    escapeHandler(close, focusButton)({ key: 'ArrowDown' });
    escapeHandler(close, focusButton)({ key: 'Tab' });
    expect(close).not.toHaveBeenCalled();
    expect(focusButton).not.toHaveBeenCalled();
  });
});
