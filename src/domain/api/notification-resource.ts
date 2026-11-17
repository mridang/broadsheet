/**
 * @packageDocumentation
 *
 * A feed's notifications on the wire: the representation
 * `/api/users/self/notifications/{feed_id}` sends, and checking the body a
 * client puts to set them.
 */

import { parseFeedId, rfc3339 } from '@/domain/api/feed-resource';
import { isMember } from '@/domain/members';
import { MAX_RULE_LENGTH, regexProblem } from '@/domain/rules';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_FILTERS,
  REGEX_KINDS,
  RULE_KINDS,
  RULE_SCOPES,
} from '@/domain/notifications';
import type {
  NotificationRule,
  NotificationRuleInput,
  RuleKind,
  RuleScope,
  NotificationChannel,
  NotificationFilter,
  NotificationSetting,
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
  const { filter = 'unread', channels } = body;
  const chosen = isMember(NOTIFICATION_FILTERS, filter) ? filter : undefined;
  const wanted = knownChannels(channels);
  const errors = [
    ...Object.keys(body)
      .filter((key) => key !== 'filter' && key !== 'channels')
      .map((key) => `${key}: not a member of a notification.`),
    ...(chosen === undefined
      ? [`filter: must be one of ${NOTIFICATION_FILTERS.join(', ')}.`]
      : []),
    ...channelErrors(wanted),
  ];
  return errors.length > 0 || chosen === undefined || wanted === undefined
    ? { ok: false, errors }
    : {
        ok: true,
        value: { filter: chosen, channels: [...new Set(wanted)] },
      };
}

/** The channels asked for when they are a non-empty list of known ones. */
function knownChannels(channels: unknown): NotificationChannel[] | undefined {
  return Array.isArray(channels) &&
    channels.length > 0 &&
    channels.every((c): c is NotificationChannel =>
      isMember(NOTIFICATION_CHANNELS, c),
    )
    ? channels
    : undefined;
}

/** Errors for `channels` unless it was a non-empty list of known channels. */
function channelErrors(
  known: readonly NotificationChannel[] | undefined,
): string[] {
  return known === undefined
    ? [
        `channels: must be a non-empty list of ${NOTIFICATION_CHANNELS.join(', ')}.`,
      ]
    : [];
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
  const {
    kind,
    value,
    is_regex: isRegex = false,
    scope = 'all',
    feed_id: feedId,
    section_id: sectionId,
    channels,
  } = body;
  const phrase =
    typeof value === 'string' &&
    value.trim() !== '' &&
    value.length <= MAX_RULE_LENGTH
      ? value
      : undefined;
  const problem =
    phrase !== undefined && isRegex === true ? regexProblem(phrase) : undefined;
  const chosenKind = isMember(RULE_KINDS, kind) ? kind : undefined;
  const chosenScope = isMember(RULE_SCOPES, scope) ? scope : undefined;
  const regexFlag = typeof isRegex === 'boolean' ? isRegex : undefined;
  const wanted = knownChannels(channels);
  const feed = typeof feedId === 'string' ? parseFeedId(feedId) : undefined;
  const section =
    typeof sectionId === 'string' ? parseFeedId(sectionId) : undefined;
  const errors = [
    ...Object.keys(body)
      .filter((key) => !allowed.has(key))
      .map((key) => `${key}: not a member of a notification rule.`),
    ...(chosenKind === undefined
      ? [`kind: must be one of ${RULE_KINDS.join(', ')}.`]
      : []),
    ...(regexFlag === undefined ? ['is_regex: must be true or false.'] : []),
    ...(isRegex === true && !isMember(REGEX_KINDS, kind)
      ? [`is_regex: only for ${REGEX_KINDS.join(', ')}.`]
      : []),
    ...(phrase === undefined
      ? [
          `value: must be non-blank text of at most ${MAX_RULE_LENGTH} characters.`,
        ]
      : []),
    ...(problem ? [`value: ${problem}.`] : []),
    ...(chosenScope === undefined
      ? [`scope: must be one of ${RULE_SCOPES.join(', ')}.`]
      : []),
    ...(scope === 'feed' && feed === undefined
      ? ['feed_id: must name one of your feeds.']
      : []),
    ...(scope !== 'feed' && feedId !== undefined
      ? ['feed_id: only for a feed rule.']
      : []),
    ...(scope === 'section' && section === undefined
      ? ['section_id: must name one of your sections.']
      : []),
    ...(scope !== 'section' && sectionId !== undefined
      ? ['section_id: only for a section rule.']
      : []),
    ...channelErrors(wanted),
  ];
  if (errors.length > 0 || chosenKind === undefined || phrase === undefined) {
    return { ok: false, errors };
  }
  if (regexFlag === undefined || chosenScope === undefined) {
    return { ok: false, errors };
  }
  if (wanted === undefined) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      kind: chosenKind,
      value: regexFlag ? phrase : phrase.trim(),
      is_regex: regexFlag,
      scope: chosenScope,
      ...(feed === undefined ? {} : { feed_id: feed }),
      ...(section === undefined ? {} : { section_id: section }),
      channels: [...new Set(wanted)],
    },
  };
}
