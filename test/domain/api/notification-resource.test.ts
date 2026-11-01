import { describe, expect, it } from '@jest/globals';

import {
  notificationResource,
  parseNotificationInput,
} from '@/domain/api/notification-resource';

describe('notificationResource', () => {
  it('shows the feed id as a string with the filter and channels', () => {
    expect(
      notificationResource(4, { filter: 'focus', channels: ['web'] }),
    ).toEqual({
      feed_id: '4',
      filter: 'focus',
      channels: ['web'],
    });
  });
});

describe('parseNotificationInput', () => {
  it.each([
    [{ channels: ['web'] }, { filter: 'unread', channels: ['web'] }],
    [
      { filter: 'focus', channels: ['email', 'webhook', 'email'] },
      { filter: 'focus', channels: ['email', 'webhook'] },
    ],
  ])('accepts %j', (body, value) => {
    expect(parseNotificationInput(body)).toEqual({ ok: true, value });
  });

  it.each([
    [
      { channels: [] },
      'channels: must be a non-empty list of web, email, webhook.',
    ],
    [
      { channels: ['ios'] },
      'channels: must be a non-empty list of web, email, webhook.',
    ],
    [{}, 'channels: must be a non-empty list of web, email, webhook.'],
    [
      { filter: 'all', channels: ['web'] },
      'filter: must be one of unread, focus.',
    ],
    [
      { channels: ['web'], muted: true },
      'muted: not a member of a notification.',
    ],
  ])('refuses %j', (body, error) => {
    const result = parseNotificationInput(body);
    expect(!result.ok && result.errors).toContain(error);
  });
});
