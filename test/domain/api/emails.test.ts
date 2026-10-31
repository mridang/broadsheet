import { describe, expect, it } from '@jest/globals';

import { mailtoLink, storyEmail } from '@/domain/api/emails';

const article = {
  title: 'A story',
  url: 'https://x/1',
  summary: 'What happened.',
  source: 'X',
};

describe('storyEmail', () => {
  it('puts the title, source, summary and address in plain text', () => {
    const { subject, text } = storyEmail(article);
    expect(subject).toBe('A story');
    expect(text).toContain('From X');
    expect(text).toContain('What happened.');
    expect(text).toContain('https://x/1');
  });

  it('falls back to the address when there is no title', () => {
    expect(
      storyEmail({ ...article, title: null, source: null, summary: null })
        .subject,
    ).toBe('https://x/1');
  });
});

describe('mailtoLink', () => {
  it('opens a mail with the story filled in and no recipient', () => {
    const link = mailtoLink(article);
    expect(link.startsWith('mailto:?subject=A%20story&body=')).toBe(true);
    expect(decodeURIComponent(link.split('body=')[1]!)).toContain(
      'https://x/1',
    );
  });
});
