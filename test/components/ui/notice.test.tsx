import { describe, expect, it } from '@jest/globals';

import { EmptyState, ErrorText } from '@/components/ui/notice';
import { html } from '../render';

describe('EmptyState', () => {
  it('says what is missing and what to do about it', () => {
    const out = html(
      <EmptyState title="No feeds yet" action={<a href="/feeds">Add</a>}>
        Add one above.
      </EmptyState>,
    );
    expect(out).toContain('No feeds yet');
    expect(out).toContain('Add one above.');
    expect(out).toContain('href="/feeds"');
  });
});

describe('ErrorText', () => {
  it('is announced as an alert', () => {
    expect(html(<ErrorText>Broke</ErrorText>)).toMatch(
      /<p role="alert"[^>]*>Broke<\/p>/,
    );
  });
});
