import { describe, expect, it } from '@jest/globals';

import { KeyboardShortcuts } from '@/app/(site)/_components/keyboard-shortcuts';
import { html } from '../../../components/render';

describe('KeyboardShortcuts', () => {
  const out = html(<KeyboardShortcuts />);

  it('keeps the help in a closed dialog named by its heading', () => {
    expect(out).toMatch(/<dialog[^>]*aria-labelledby="keyhelp-title"/);
    expect(out).not.toMatch(/<dialog[^>]*\sopen/);
    expect(out).toMatch(/id="keyhelp-title"[^>]*>Keyboard shortcuts<\/h2>/);
  });

  it('lists each key', () => {
    ['n', 'g', 'A', 'Y', 'Shift Enter', 'c', '?'].forEach((key) =>
      expect(out).toContain(`>${key}</kbd>`),
    );
  });

  it('has a closed picker for going to a section', () => {
    expect(out).toMatch(/<dialog[^>]*aria-labelledby="goto-title"/);
    expect(out).toContain('aria-label="Section name"');
  });

  it('closes with a button', () => {
    expect(out).toMatch(/<button type="submit"[^>]*>Close<\/button>/);
  });
});
