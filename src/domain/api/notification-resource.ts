/**
 * @packageDocumentation
 *
 * A feed's notifications on the wire: the representation
 * `/api/users/self/notifications/{feed_id}` sends, and checking the body a
 * client puts to set them.
 */

import { parseFeedId, rfc3339 } from '@/domain/api/feed-resource';
import { MAX_RULE_LENGTH, regexProblem } from '@/domain/rules';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_FILTERS,
  REGEX_KINDS,
  RULE_KINDS,
  RULE_SCOPES,
  type NotificationRule,
  type NotificationRuleInput,
  type RuleKind,
  type RuleScope,
  type NotificationChannel,
  type NotificationFilter,
  type NotificationSetting,
} from '@/domain/notifications';
import type { Checked } from '@/domain/api/outbound-resource';

/** A feed's notifications as the API shows them. */
export interface NotificationResource {
  readonly feed_id: string;
  readonly filter: NotificationFilter;
  readonly channels: readonly NotificationChannel[];
}

/** The API's view of one feed's notifications. */
export function notificationResource(
  feedId: number,
  setting: NotificationSetting,
): NotificationResource {
  return {
    feed_id: String(feedId),
    filter: setting.filter,
    channels: setting.channels,
  };
}

/**
 * Check a notification body: `filter` unread or focus (unread when left
 * out), `channels` a non-empty list of web, email and webhook. Turning every
 * channel off is a DELETE, not an empty list.
 */
export function parseNotificationInput(
  body: Readonly<Record<string, unknown>>,
): Checked<NotificationSetting> {
  const errors = Object.keys(body)
    .filter((key) => key !== 'filter' && key !== 'channels')
    .map((key) => `${key}: not a member of a notification.`);
  const { filter = 'unread', channels } = body;
  if (!(NOTIFICATION_FILTERS as readonly unknown[]).includes(filter)) {
    errors.push(`filter: must be one of ${NOTIFICATION_FILTERS.join(', ')}.`);
  }
  if (
    !Array.isArray(channels) ||
    channels.length === 0 ||
    !channels.every((c) =>
      (NOTIFICATION_CHANNELS as readonly unknown[]).includes(c),
    )
  ) {
    errors.push(
      `channels: must be a non-empty list of ${NOTIFICATION_CHANNELS.join(', ')}.`,
    );
  }
  return errors.length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          filter: filter as NotificationFilter,
          channels: [...new Set(channels as NotificationChannel[])],
        },
      };
}

/** Errors for `channels` unless it is a non-empty list of known channels. */
function channelErrors(channels: unknown): string[] {
  return Array.isArray(channels) &&
    channels.length > 0 &&
    channels.every((c) =>
      (NOTIFICATION_CHANNELS as readonly unknown[]).includes(c),
    )
    ? []
    : [
        `channels: must be a non-empty list of ${NOTIFICATION_CHANNELS.join(', ')}.`,
      ];
}

/** A notification rule as the API shows it. */
export interface NotificationRuleResource {
  readonly id: string;
  readonly kind: RuleKind;
  readonly value: string;
  readonly is_regex: boolean;
  readonly scope: RuleScope;
  readonly feed_id?: string;
  readonly section_id?: string;
  readonly channels: readonly NotificationChannel[];
  readonly created_at?: string;
}

/** The API's view of a stored rule. */
export function notificationRuleResource(
  rule: Readonly<NotificationRule>,
): NotificationRuleResource {
  const at = rule.created_at ? rfc3339(rule.created_at) : undefined;
  return {
    id: String(rule.id),
    kind: rule.kind,
    value: rule.value,
    is_regex: rule.is_regex,
    scope: rule.scope,
    ...(rule.feed_id === undefined ? {} : { feed_id: String(rule.feed_id) }),
    ...(rule.section_id === undefined
      ? {}
      : { section_id: String(rule.section_id) }),
    channels: rule.channels,
    ...(at ? { created_at: at } : {}),
  };
}

/**
 * Check a rule body: `kind` title, author, tag, text or url; `value` a
 * non-blank phrase of at most 200 characters, or with `is_regex` a regular
 * expression that cannot backtrack without end (title, author, text and url
 * only); `scope` feed (with `feed_id`), section (with `section_id`) or all
 * (the default); `channels` as for a feed.
 */
export function parseNotificationRuleInput(
  body: Readonly<Record<string, unknown>>,
): Checked<NotificationRuleInput> {
  const allowed = new Set([
    'kind',
    'value',
    'is_regex',
    'scope',
    'feed_id',
    'section_id',
    'channels',
  ]);
  const errors = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => `${key}: not a member of a notification rule.`);
  const {
    kind,
    value,
    is_regex: isRegex = false,
    scope = 'all',
    feed_id: feedId,
    section_id: sectionId,
    channels,
  } = body;
  if (!(RULE_KINDS as readonly unknown[]).includes(kind)) {
    errors.push(`kind: must be one of ${RULE_KINDS.join(', ')}.`);
  }
  if (typeof isRegex !== 'boolean') {
    errors.push('is_regex: must be true or false.');
  } else if (isRegex && !(REGEX_KINDS as readonly unknown[]).includes(kind)) {
    errors.push(`is_regex: only for ${REGEX_KINDS.join(', ')}.`);
  } else {
    // A regex flag on a kind that accepts one needs no error.
  }
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > MAX_RULE_LENGTH
  ) {
    errors.push(
      `value: must be non-blank text of at most ${MAX_RULE_LENGTH} characters.`,
    );
  } else if (isRegex === true) {
    const problem = regexProblem(value);
    if (problem) errors.push(`value: ${problem}.`);
  } else {
    // A value that is not a regex, or a valid one, needs no error here.
  }
  if (!(RULE_SCOPES as readonly unknown[]).includes(scope)) {
    errors.push(`scope: must be one of ${RULE_SCOPES.join(', ')}.`);
  }
  const feed = typeof feedId === 'string' ? parseFeedId(feedId) : undefined;
  const section =
    typeof sectionId === 'string' ? parseFeedId(sectionId) : undefined;
  if (scope === 'feed' && feed === undefined) {
    errors.push('feed_id: must name one of your feeds.');
  } else if (scope !== 'feed' && feedId !== undefined) {
    errors.push('feed_id: only for a feed rule.');
  } else {
    // A feed the rule names, or none, is already checked above.
  }
  if (scope === 'section' && section === undefined) {
    errors.push('section_id: must name one of your sections.');
  } else if (scope !== 'section' && sectionId !== undefined) {
    errors.push('section_id: only for a section rule.');
  } else {
    // A section the rule names, or none, is already checked above.
  }
  errors.push(...channelErrors(channels));
  return errors.length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          kind: kind as RuleKind,
          value: isRegex ? (value as string) : (value as string).trim(),
          is_regex: isRegex as boolean,
          scope: scope as RuleScope,
          ...(feed === undefined ? {} : { feed_id: feed }),
          ...(section === undefined ? {} : { section_id: section }),
          channels: [...new Set(channels as NotificationChannel[])],
        },
      };
}
