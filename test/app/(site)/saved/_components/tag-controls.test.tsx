import { describe, expect, it } from '@jest/globals';

import { TagControls } from '@/app/(site)/saved/_components/tag-controls';
import { html } from '../../../../components/render';

const RENAMES_WITH_A_SUBMIT_PATTERN =
  /<button type="submit"[^>]*>Rename<\/button>/;
const RENAMES_WITH_A_SUBMIT_PATTERN_2 =
  /<button type="button"[^>]*>Delete tag<\/button>/;

describe('TagControls', () => {
  const out = html(<TagControls tag="old news" />);

  it('starts the rename field at the tag’s name', () => {
    expect(out).toContain('value="old news"');
  });

  it('renames with a submit button and deletes with a plain one', () => {
    expect(out).toMatch(RENAMES_WITH_A_SUBMIT_PATTERN);
    expect(out).toMatch(RENAMES_WITH_A_SUBMIT_PATTERN_2);
  });
});
