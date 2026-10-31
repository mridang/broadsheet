import { describe, expect, it } from '@jest/globals';

import { KeyboardShortcuts } from '@/app/(site)/_components/keyboard-shortcuts';
import { html } from '../../../components/render';

describe('KeyboardShortcuts', () => {
  const out = html(<KeyboardShortcuts />);

  it('keeps the help in a closed dialog named by its heading', () => {
    expect(out).toMatch(/<dialog[^>]*aria-labelledby="keyhelp-title"/);
    expect(out).not.toMatch(/<dialog[^>]*\sopen/);
    expect(out).toContain('id="keyhelp-title">Keyboard shortcuts</h2>');
  });

  it('lists each key', () => {
    ['j', 'k', 'o or Enter', '?'].forEach((key) =>
      expect(out).toContain(`<kbd>${key}</kbd>`),
    );
  });

  it('closes with a button', () => {
    expect(out).toMatch(/<button type="submit"[^>]*>Close<\/button>/);
  });
});
