import { describe, expect, it } from '@jest/globals';

import {
  feedTokenResource,
  parseEmailInput,
  parseFeedTokenInput,
  parsePushSubscriptionInput,
  parseWebhookInput,
  pushSubscriptionResource,
  webhookResource,
} from '@/domain/api/outbound-resource';

const P256DH = 'B'.repeat(87);
const AUTH = 'A'.repeat(22);

describe('parsePushSubscriptionInput', () => {
  it('accepts what a browser’s toJSON gives', () => {
    expect(
      parsePushSubscriptionInput({
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        expirationTime: null,
        keys: { p256dh: P256DH, auth: AUTH },
      }),
    ).toEqual({
      ok: true,
      value: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        p256dh: P256DH,
        auth: AUTH,
      },
    });
  });

  it.each([
    [
      {
        endpoint: 'http://push.example.com/x',
        keys: { p256dh: P256DH, auth: AUTH },
      },
      'endpoint: must be a public https address.',
    ],
    [
      { endpoint: 'https://127.0.0.1/x', keys: { p256dh: P256DH, auth: AUTH } },
      'endpoint: must be a public https address.',
    ],
    [
      {
        endpoint: 'https://push.example.com/x',
        keys: { p256dh: 'short', auth: AUTH },
      },
      'keys.p256dh: must be the base64url P-256 public key.',
    ],
    [
      { endpoint: 'https://push.example.com/x', keys: { p256dh: P256DH } },
      'keys.auth: must be the base64url auth secret.',
    ],
    [
      {
        endpoint: 'https://push.example.com/x',
        keys: { p256dh: P256DH, auth: AUTH },
        extra: 1,
      },
      'extra: not a member of a push subscription.',
    ],
  ])('refuses %j', (body, error) => {
    const result = parsePushSubscriptionInput(body);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toContain(error);
  });
});

describe('pushSubscriptionResource', () => {
  it('shows the id, endpoint and time, never the keys', () => {
    expect(
      pushSubscriptionResource({
        id: 3,
        user_id: 1,
        endpoint: 'https://p/x',
        p256dh: 'k',
        auth: 'a',
        created_at: '2026-10-01 10:00:00',
      }),
    ).toEqual({
      id: '3',
      endpoint: 'https://p/x',
      created_at: '2026-10-01T10:00:00Z',
    });
  });
});

describe('parseWebhookInput', () => {
  it('accepts an https address and drops repeated events', () => {
    expect(
      parseWebhookInput({
        url: 'https://hooks.example.com/a',
        events: ['save', 'save', 'like'],
      }),
    ).toEqual({
      ok: true,
      value: { url: 'https://hooks.example.com/a', events: ['save', 'like'] },
    });
  });

  it.each([
    [
      { url: 'http://hooks.example.com/a', events: ['save'] },
      'url: must be a public https address.',
    ],
    [
      { url: 'https://localhost/a', events: ['save'] },
      'url: must be a public https address.',
    ],
    [
      { url: 'https://hooks.example.com/a', events: [] },
      'events: must be a non-empty list of save, like.',
    ],
    [
      { url: 'https://hooks.example.com/a', events: ['read'] },
      'events: must be a non-empty list of save, like.',
    ],
  ])('refuses %j', (body, error) => {
    const result = parseWebhookInput(body);
    expect(!result.ok && result.errors).toContain(error);
  });
});

describe('webhookResource', () => {
  const hook = {
    id: 2,
    user_id: 1,
    url: 'https://h/x',
    events: ['save'] as const,
    secret: 'shh',
    created_at: null,
  };

  it('hides the secret unless asked to reveal it', () => {
    expect(webhookResource(hook)).toEqual({
      id: '2',
      url: 'https://h/x',
      events: ['save'],
    });
    expect(webhookResource(hook, true)).toMatchObject({ secret: 'shh' });
  });
});

describe('parseFeedTokenInput', () => {
  it.each([
    [{ scope: 'saves' }, { scope: 'saves' }],
    [
      { scope: 'saves', tag: ' rust ' },
      { scope: 'saves', tag: 'rust' },
    ],
    [
      { scope: 'section', section_id: '4' },
      { scope: 'section', section_id: 4 },
    ],
    [{ scope: 'edition' }, { scope: 'edition' }],
  ])('accepts %j', (body, value) => {
    expect(parseFeedTokenInput(body)).toEqual({ ok: true, value });
  });

  it.each([
    [{ scope: 'all' }, 'scope: must be one of saves, section, edition.'],
    [{ scope: 'edition', tag: 'x' }, 'tag: only for a saves feed.'],
    [{ scope: 'saves', tag: ' ' }, 'tag: must be a non-blank string.'],
    [{ scope: 'section' }, 'section_id: must name one of your sections.'],
    [
      { scope: 'section', section_id: 'x' },
      'section_id: must name one of your sections.',
    ],
    [
      { scope: 'saves', section_id: '4' },
      'section_id: only for a section feed.',
    ],
  ])('refuses %j', (body, error) => {
    const result = parseFeedTokenInput(body);
    expect(!result.ok && result.errors).toContain(error);
  });
});

describe('feedTokenResource', () => {
  const row = {
    id: 5,
    user_id: 1,
    token_hash: 'h',
    scope: 'section' as const,
    tag: null,
    section_id: 4,
    created_at: null,
  };

  it('shows the scope, and the token and its feed address only when given', () => {
    expect(feedTokenResource(row)).toEqual({
      id: '5',
      scope: 'section',
      section_id: '4',
    });
    expect(
      feedTokenResource(row, { token: 'a b', origin: 'https://paper.test' }),
    ).toMatchObject({
      token: 'a b',
      feed_url: 'https://paper.test/feed.xml?token=a%20b',
    });
  });
});

describe('parseEmailInput', () => {
  it('accepts one address', () => {
    expect(parseEmailInput({ to: 'a@b.co' })).toEqual({
      ok: true,
      value: { to: 'a@b.co' },
    });
  });

  it.each([
    { to: 'a@b' },
    { to: 'a@b.co, c@d.co' },
    {},
    { to: 'a@b.co', cc: 'x' },
  ])('refuses %j', (body) => {
    expect(parseEmailInput(body).ok).toBe(false);
  });
});
