/**
 * @packageDocumentation
 *
 * How each of the person's feeds tells them about new stories, as a REST
 * resource keyed by the feed. Each runs as the signed-in person.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import {
  notificationResource,
  notificationRuleResource,
  parseNotificationInput,
  parseNotificationRuleInput,
} from '@/domain/api/notification-resource';
import { getDatabase } from '@/domain/db/client';
import {
  NotificationRepository,
  type NotificationRule,
  type NotificationRuleInput,
  type NotificationSetting,
} from '@/domain/notifications';
import {
  ApiController,
  created,
  noContent,
  ok,
  problems,
  readJsonObject,
} from '@/lib/core/api';

/** The signed-in caller's id and the request. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** What a PUT came to: the feed and its setting, or nothing when not theirs. */
type Stored =
  | {
      readonly feedId: number;
      readonly setting: NotificationSetting;
      readonly created: boolean;
    }
  | undefined;

/**
 * `PUT /api/users/self/notifications/:feed_id` {filter?, channels}: tell the
 * person about new stories in one of their feeds. 201 the first time, 200 when
 * it replaced what was there; 400/415 for a bad body, 404 when the feed is not
 * theirs.
 *
 * `DELETE /api/users/self/notifications/:feed_id`: stop. 204, or 404 when the
 * feed did not notify.
 *
 * Both answer 401/403 when not signed in or cross-site.
 */
export function createNotificationItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<NotificationSetting, Stored>({
      method: 'PUT',
      decode: async (request) => {
        const body = await readJsonObject(
          request,
          'The notification must be a JSON object.',
        );
        if (!body.ok) throw body.response;
        const input = parseNotificationInput(body.value);
        if (!input.ok) {
          throw problems.badRequest(
            'The notification is not valid.',
            input.errors,
          );
        }
        return input.value;
      },
      handle: async (setting, { request, uid }) => {
        const feedId = parseFeedId(idOf(request));
        if (feedId === undefined) return undefined;
        const stored = await new NotificationRepository(
          getDatabase(),
        ).setFeedNotification(uid, feedId, setting);
        return stored && { feedId, setting, created: stored.created };
      },
      encode: (stored) => {
        if (!stored) return problems.notFound('feed');
        const body = notificationResource(stored.feedId, stored.setting);
        const at = `/api/users/self/notifications/${stored.feedId}`;
        return stored.created ? created(body, at) : ok(body, { location: at });
      },
    })
    .on<null, boolean>({
      method: 'DELETE',
      handle: async (_input, { request, uid }) => {
        const feedId = parseFeedId(idOf(request));
        return feedId === undefined
          ? false
          : new NotificationRepository(getDatabase()).removeFeedNotification(
              uid,
              feedId,
            );
      },
      encode: (removed) =>
        removed ? noContent() : problems.notFound('notification'),
    });
}

/** The notification controller bound to the production resolver. */
export const notificationItem = createNotificationItem();

/**
 * `POST /api/users/self/notifications/rules` {kind, value, is_regex?, scope?,
 * feed_id?, section_id?, channels}: be told about new stories a classifier
 * matches, as NewsBlur's classifier notifications do. 201 with the rule and
 * its `Location`; 400 for a bad body (or a feed or section that is not the
 * person's), 415 for a non-JSON body, 401/403 when not signed in or
 * cross-site.
 */
export function createNotificationRules(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<NotificationRuleInput, NotificationRule>({
    method: 'POST',
    decode: async (request) => {
      const body = await readJsonObject(
        request,
        'The notification rule must be a JSON object.',
      );
      if (!body.ok) throw body.response;
      const input = parseNotificationRuleInput(body.value);
      if (!input.ok) {
        throw problems.badRequest(
          'The notification rule is not valid.',
          input.errors,
        );
      }
      return input.value;
    },
    handle: async (input, { uid }) => {
      const rule = await new NotificationRepository(getDatabase()).addRule(
        uid,
        input,
      );
      if (!rule) {
        throw problems.badRequest('The notification rule is not valid.', [
          input.feed_id === undefined
            ? 'section_id: must name one of your sections.'
            : 'feed_id: must name one of your feeds.',
        ]);
      }
      return rule;
    },
    encode: (rule) =>
      created(
        notificationRuleResource(rule),
        `/api/users/self/notifications/rules/${rule.id}`,
      ),
  });
}

/** The rule collection bound to the production resolver. */
export const notificationRules = createNotificationRules();

/**
 * `DELETE /api/users/self/notifications/rules/:id`: stop a rule. 204, 404
 * when the person has no such rule, 401/403 when not signed in or cross-site.
 */
export function createNotificationRuleItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, boolean>({
    method: 'DELETE',
    handle: async (_input, { request, uid }) => {
      const id = parseFeedId(idOf(request));
      return id === undefined
        ? false
        : new NotificationRepository(getDatabase()).removeRule(uid, id);
    },
    encode: (removed) =>
      removed ? noContent() : problems.notFound('notification rule'),
  });
}

/** The rule item bound to the production resolver. */
export const notificationRuleItem = createNotificationRuleItem();
