import { describe, expect, it } from '@jest/globals';

import {
  notificationResource,
  notificationRuleResource,
  parseNotificationInput,
  parseNotificationRuleInput,
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

describe('parseNotificationRuleInput', () => {
  it.each([
    [
      { kind: 'title', value: ' rust ', channels: ['web'] },
      {
        kind: 'title',
        value: 'rust',
        is_regex: false,
        scope: 'all',
        channels: ['web'],
      },
    ],
    [
      {
        kind: 'url',
        value: '^https://a\\.',
        is_regex: true,
        scope: 'feed',
        feed_id: '3',
        channels: ['email'],
      },
      {
        kind: 'url',
        value: '^https://a\\.',
        is_regex: true,
        scope: 'feed',
        feed_id: 3,
        channels: ['email'],
      },
    ],
    [
      {
        kind: 'tag',
        value: 'go',
        scope: 'section',
        section_id: '2',
        channels: ['webhook'],
      },
      {
        kind: 'tag',
        value: 'go',
        is_regex: false,
        scope: 'section',
        section_id: 2,
        channels: ['webhook'],
      },
    ],
  ])('accepts %j', (body, value) => {
    expect(parseNotificationRuleInput(body)).toEqual({ ok: true, value });
  });

  it.each([
    [
      { kind: 'prompt', value: 'x', channels: ['web'] },
      'kind: must be one of title, author, tag, text, url.',
    ],
    [
      { kind: 'tag', value: 'x', is_regex: true, channels: ['web'] },
      'is_regex: only for title, author, text, url.',
    ],
    [
      { kind: 'title', value: 'x', is_regex: 'yes', channels: ['web'] },
      'is_regex: must be true or false.',
    ],
    [
      { kind: 'title', value: ' ', channels: ['web'] },
      'value: must be non-blank text of at most 200 characters.',
    ],
    [
      { kind: 'title', value: '(a+)+', is_regex: true, channels: ['web'] },
      'value: a repeated group may not itself repeat.',
    ],
    [
      { kind: 'title', value: 'x', scope: 'folder', channels: ['web'] },
      'scope: must be one of feed, section, all.',
    ],
    [
      { kind: 'title', value: 'x', scope: 'feed', channels: ['web'] },
      'feed_id: must name one of your feeds.',
    ],
    [
      { kind: 'title', value: 'x', feed_id: '3', channels: ['web'] },
      'feed_id: only for a feed rule.',
    ],
    [
      { kind: 'title', value: 'x', scope: 'section', channels: ['web'] },
      'section_id: must name one of your sections.',
    ],
    [
      { kind: 'title', value: 'x', section_id: '2', channels: ['web'] },
      'section_id: only for a section rule.',
    ],
    [
      { kind: 'title', value: 'x', channels: [] },
      'channels: must be a non-empty list of web, email, webhook.',
    ],
    [
      { kind: 'title', value: 'x', channels: ['web'], frequency: 1 },
      'frequency: not a member of a notification rule.',
    ],
  ])('refuses %j', (body, error) => {
    const result = parseNotificationRuleInput(body);
    expect(!result.ok && result.errors).toContain(error);
  });
});

describe('notificationRuleResource', () => {
  it('shows ids as strings and leaves out what the rule lacks', () => {
    expect(
      notificationRuleResource({
        id: 9,
        kind: 'title',
        value: 'rust',
        is_regex: false,
        scope: 'feed',
        feed_id: 3,
        channels: ['web'],
        created_at: '2026-10-01 10:00:00',
      }),
    ).toEqual({
      id: '9',
      kind: 'title',
      value: 'rust',
      is_regex: false,
      scope: 'feed',
      feed_id: '3',
      channels: ['web'],
      created_at: '2026-10-01T10:00:00Z',
    });
  });
});
