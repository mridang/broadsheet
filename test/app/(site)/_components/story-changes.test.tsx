import { describe, expect, it } from '@jest/globals';

import { StoryChanges } from '@/app/(site)/_components/story-changes';
import { html } from '../../../components/render';

describe('StoryChanges', () => {
  const out = html(
    <StoryChanges original="<p>Ten were hurt</p>" current="Twelve were hurt" />,
  );

  it('is a closed disclosure that stays off paper', () => {
    expect(out).toMatch(/^<details class="[^"]*print:hidden/);
    expect(out).not.toMatch(/<details[^>]*\sopen/);
    expect(out).toContain('show changes</summary>');
  });

  it('strikes what was taken out and marks what was added, as text', () => {
    expect(out).toMatch(/<del[^>]*>Ten <\/del>/);
    expect(out).toMatch(/<ins[^>]*>Twelve <\/ins>/);
    expect(out).not.toContain('<p>Ten');
  });
});
