import { describe, expect, it } from '@jest/globals';

import { StoryChanges } from '@/app/(site)/_components/story-changes';
import { html } from '../../../components/render';

const IS_A_CLOSED_DISCLOSURE_PATTERN = /^<details class="[^"]*print:hidden/;
const IS_A_CLOSED_DISCLOSURE_PATTERN_2 = /<details[^>]*\sopen/;
const STRIKES_WHAT_WAS_TAKEN_PATTERN = /<del[^>]*>Ten <\/del>/;
const STRIKES_WHAT_WAS_TAKEN_PATTERN_2 = /<ins[^>]*>Twelve <\/ins>/;

describe('StoryChanges', () => {
  const out = html(
    <StoryChanges original="<p>Ten were hurt</p>" current="Twelve were hurt" />,
  );

  it('is a closed disclosure that stays off paper', () => {
    expect(out).toMatch(IS_A_CLOSED_DISCLOSURE_PATTERN);
    expect(out).not.toMatch(IS_A_CLOSED_DISCLOSURE_PATTERN_2);
    expect(out).toContain('show changes</summary>');
  });

  it('strikes what was taken out and marks what was added, as text', () => {
    expect(out).toMatch(STRIKES_WHAT_WAS_TAKEN_PATTERN);
    expect(out).toMatch(STRIKES_WHAT_WAS_TAKEN_PATTERN_2);
    expect(out).not.toContain('<p>Ten');
  });
});
