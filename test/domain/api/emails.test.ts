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

describe('storyEmail with a sender', () => {
  const sent = storyEmail(
    { ...article, title: 'A <b> story', body_text: 'First.\n\nSecond.' },
    { sender: 'Ann', comment: 'Read this' },
  );

  it('opens with the sender’s note and carries the kept text', () => {
    expect(sent.text.startsWith('Ann wrote: Read this')).toBe(true);
    expect(sent.text).toContain('First.\n\nSecond.');
    expect(sent.text).toContain('Sent by Ann from');
  });

  it('escapes the story in the HTML part and links the original', () => {
    expect(sent.html).toContain('<h1>A &lt;b&gt; story</h1>');
    expect(sent.html).toContain('<a href="https://x/1">https://x/1</a>');
  });
});

describe('mailtoLink', () => {
  it('leaves the kept text out, so the address stays short', () => {
    const link = mailtoLink({ ...article, body_text: 'LONG BODY' });
    expect(decodeURIComponent(link)).not.toContain('LONG BODY');
  });

  it('opens a mail with the story filled in and no recipient', () => {
    const link = mailtoLink(article);
    expect(link.startsWith('mailto:?subject=A%20story&body=')).toBe(true);
    expect(decodeURIComponent(link.split('body=')[1]!)).toContain(
      'https://x/1',
    );
  });
});
