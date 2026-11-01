import { describe, expect, it } from '@jest/globals';

import { emailRequest } from '@/app/(site)/article/[id]/_components/email-story-form';

describe('emailRequest', () => {
  it('sends the addresses, the note and whether to copy the sender', () => {
    const form = new FormData();
    form.set('to', 'a@b.co, c@d.co');
    form.set('comment', ' Look ');
    form.set('copy_me', 'on');
    expect(emailRequest(form)).toEqual({
      to: 'a@b.co, c@d.co',
      comment: 'Look',
      copy_me: true,
    });
  });

  it('leaves out an empty note and sends no copy when unticked', () => {
    const form = new FormData();
    form.set('to', 'a@b.co');
    expect(emailRequest(form)).toEqual({ to: 'a@b.co', copy_me: false });
  });
});
