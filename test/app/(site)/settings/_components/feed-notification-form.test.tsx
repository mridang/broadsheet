import { describe, expect, it } from '@jest/globals';

import { notificationRequest } from '@/app/(site)/settings/_components/feed-notification-form';

describe('notificationRequest', () => {
  it('sends the filter and every ticked channel', () => {
    const form = new FormData();
    form.set('filter', 'focus');
    form.append('channels', 'web');
    form.append('channels', 'webhook');
    expect(notificationRequest(form)).toEqual({
      filter: 'focus',
      channels: ['web', 'webhook'],
    });
  });

  it('sends no channels when none is ticked, which turns the feed off', () => {
    expect(notificationRequest(new FormData())).toEqual({
      filter: 'unread',
      channels: [],
    });
  });
});
