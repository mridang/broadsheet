import { describe, expect, it } from '@jest/globals';

import { EmptyState, ErrorText, Notice } from '@/components/ui/notice';
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

describe('EmptyState with an icon', () => {
  it('draws the icon above the title', () => {
    const out = html(<EmptyState title="Nothing saved" icon="bookmark" />);
    expect(out.indexOf('<svg')).toBeLessThan(out.indexOf('Nothing saved'));
  });
});

describe('Notice', () => {
  it('takes its colours from the tone and its role from the caller', () => {
    const out = html(
      <Notice tone="danger" role="alert">
        Failed
      </Notice>,
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain('text-danger');
  });
});
