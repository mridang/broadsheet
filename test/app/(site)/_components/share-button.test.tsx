import { describe, expect, it } from '@jest/globals';

import { ShareButton } from '@/app/(site)/_components/share-button';
import { html } from '../../../components/render';

const OFFERS_TO_SHARE_A_PATTERN = /^<details class="[^"]*print:hidden/u;
const OFFERS_TO_SHARE_A_PATTERN_2 =
  /<summary[^>]*aria-label="Share A"[^>]*>Share<\/summary>/u;
const OFFERS_TO_SHARE_A_PATTERN_3 =
  /<button type="submit"[^>]*>Share<\/button>/u;
const SAYS_A_SHARED_STORY_PATTERN =
  /<button type="submit"[^>]*>Update<\/button>/u;
const SAYS_A_SHARED_STORY_PATTERN_2 =
  /<button type="button"[^>]*>Unshare<\/button>/u;
const LABELS_THE_COMMENT_AND_PATTERN = /<label for="[^"]+"[^>]*>Comment/u;
const OPENS_FROM_A_BUTTON_PATTERN =
  /^<span class="[^"]*print:hidden[^"]*" data-action="share"/u;
const OPENS_FROM_A_BUTTON_PATTERN_2 =
  /<button type="button" aria-label="Share A"[^>]*>Share<\/button>/u;
const OPENS_FROM_A_BUTTON_PATTERN_3 = /popover="auto" data-popover=""/u;

describe('ShareButton', () => {
  it('offers to share a story not yet shared, off paper', () => {
    const out = html(
      <ShareButton articleId={7} shared={false} title="A" inline />,
    );
    expect(out).toMatch(OFFERS_TO_SHARE_A_PATTERN);
    expect(out).toMatch(OFFERS_TO_SHARE_A_PATTERN_2);
    expect(out).toMatch(OFFERS_TO_SHARE_A_PATTERN_3);
    expect(out).not.toContain('Unshare');
  });

  it('says a shared story is shared, and offers to change or stop it', () => {
    const out = html(<ShareButton articleId={7} shared title="A" inline />);
    expect(out).toContain('✓ Shared');
    expect(out).toMatch(SAYS_A_SHARED_STORY_PATTERN);
    expect(out).toMatch(SAYS_A_SHARED_STORY_PATTERN_2);
  });

  it('labels the comment and says shares are public', () => {
    const out = html(
      <ShareButton articleId={7} shared={false} title="A" inline />,
    );
    expect(out).toMatch(LABELS_THE_COMMENT_AND_PATTERN);
    expect(out).toContain('Anyone signed in sees your share');
  });

  it('opens from a button as a popover outside a menu, off paper', () => {
    const out = html(<ShareButton articleId={7} shared={false} title="A" />);
    expect(out).toMatch(OPENS_FROM_A_BUTTON_PATTERN);
    expect(out).toMatch(OPENS_FROM_A_BUTTON_PATTERN_2);
    expect(out).toMatch(OPENS_FROM_A_BUTTON_PATTERN_3);
  });
});
