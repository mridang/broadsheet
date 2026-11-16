import { describe, expect, it } from '@jest/globals';

import { KeyboardShortcuts } from '@/app/(site)/_components/keyboard-shortcuts';
import { html } from '../../../components/render';

const KEEPS_THE_HELP_IN_PATTERN = /<dialog[^>]*aria-labelledby="keyhelp-title"/;
const KEEPS_THE_HELP_IN_PATTERN_2 = /<dialog[^>]*\sopen/;
const KEEPS_THE_HELP_IN_PATTERN_3 =
  /id="keyhelp-title"[^>]*>Keyboard shortcuts<\/h2>/;
const HAS_A_CLOSED_PICKER_PATTERN = /<dialog[^>]*aria-labelledby="goto-title"/;
const CLOSES_WITH_A_BUTTON_PATTERN =
  /<button type="submit"[^>]*>Close<\/button>/;

describe('KeyboardShortcuts', () => {
  const out = html(<KeyboardShortcuts />);

  it('keeps the help in a closed dialog named by its heading', () => {
    expect(out).toMatch(KEEPS_THE_HELP_IN_PATTERN);
    expect(out).not.toMatch(KEEPS_THE_HELP_IN_PATTERN_2);
    expect(out).toMatch(KEEPS_THE_HELP_IN_PATTERN_3);
  });

  it('lists each key', () => {
    for (const key of ['n', 'g', 'A', 'Y', 'Shift Enter', 'c', '?'])
      expect(out).toContain(`>${key}</kbd>`);
  });

  it('has a closed picker for going to a section', () => {
    expect(out).toMatch(HAS_A_CLOSED_PICKER_PATTERN);
    expect(out).toContain('aria-label="Section name"');
  });

  it('closes with a button', () => {
    expect(out).toMatch(CLOSES_WITH_A_BUTTON_PATTERN);
  });
});
