import { describe, expect, it } from '@jest/globals';

import { ShareButton } from '@/app/(site)/_components/share-button';
import { html } from '../../../components/render';

describe('ShareButton', () => {
  it('offers to share a story not yet shared, off paper', () => {
    const out = html(<ShareButton articleId={7} shared={false} title="A" />);
    expect(out).toMatch(/^<details class="[^"]*print:hidden/);
    expect(out).toMatch(
      /<summary[^>]*aria-label="Share A"[^>]*>Share<\/summary>/,
    );
    expect(out).toMatch(/<button type="submit"[^>]*>Share<\/button>/);
    expect(out).not.toContain('Unshare');
  });

  it('says a shared story is shared, and offers to change or stop it', () => {
    const out = html(<ShareButton articleId={7} shared title="A" />);
    expect(out).toContain('✓ Shared');
    expect(out).toMatch(/<button type="submit"[^>]*>Update<\/button>/);
    expect(out).toMatch(/<button type="button"[^>]*>Unshare<\/button>/);
  });

  it('labels the comment and says shares are public', () => {
    const out = html(<ShareButton articleId={7} shared={false} title="A" />);
    expect(out).toMatch(/<label for="[^"]+"[^>]*>Comment/);
    expect(out).toContain('Anyone signed in sees your share');
  });
});
