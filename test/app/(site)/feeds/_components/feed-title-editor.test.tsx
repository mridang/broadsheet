import { describe, expect, it } from '@jest/globals';

import {
  editedTitle,
  FeedTitleEditor,
} from '@/app/(site)/feeds/_components/feed-title-editor';
import { html } from '../../../../components/render';

describe('editedTitle', () => {
  it('trims what was typed', () => {
    expect(editedTitle('  Mine ')).toBe('Mine');
  });

  it('clears the title when left blank', () => {
    expect(editedTitle(' '.repeat(3))).toBeNull();
  });
});

describe('FeedTitleEditor', () => {
  const out = html(<FeedTitleEditor id={3} title="" name="a.test" />);

  it('links the name to the feed', () => {
    expect(out).toMatch(/<a[^>]*href="\/feeds\/3"[^>]*>a.test<\/a>/);
  });

  it('offers a labelled pencil to rename the feed', () => {
    expect(out).toContain('aria-label="Rename a.test"');
    expect(out).toContain('<svg');
  });

  it('shows no field until asked to rename', () => {
    expect(out).not.toContain('<input');
  });
});
