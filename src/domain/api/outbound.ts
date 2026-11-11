/**
 * @packageDocumentation
 *
 * What leaves the paper on a person's behalf, as REST resources: the Web Push
 * configuration, the person's push subscriptions, their webhooks and their
 * feed tokens. Each personal endpoint runs as the signed-in person; nothing
 * here lists, since the settings page reads the rows itself.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import {
  feedTokenResource,
  parseFeedTokenInput,
  parsePushSubscriptionInput,
  parseWebhookInput,
  pushSubscriptionResource,
  webhookResource,
  type Checked,
} from '@/domain/api/outbound-resource';
import { getDatabase } from '@/domain/db/database';
import {
  OutboundRepository,
  type FeedToken,
  type FeedTokenInput,
  type PushSubscription,
  type PushSubscriptionInput,
  type Webhook,
} from '@/domain/outbound';
import { Repository } from '@/domain/repository';
import {
  ApiController,
  created,
  noContent,
  ok,
  problem,
  problems,
  readJsonObject,
} from '@/lib/core/api';
import { appOrigin } from '@/lib/core/origin';
import { getEnv } from '@/lib/core/runtime';
import { randomToken, sha256Hex } from '@/lib/outbound/tokens';

/** The signed-in caller's id and the request. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** The context every personal endpoint here builds. */
function personal(resolver: CurrentUserResolver) {
  return async (request: Request): Promise<UidContext> => ({
    request,
    uid: await liveUid(request, resolver),
  });
}

/** Read a JSON object body and check it, throwing a 400 or 415 problem. */
async function decodeWith<T>(
  request: Request,
  what: string,
  check: (body: Readonly<Record<string, unknown>>) => Checked<T>,
): Promise<T> {
  const body = await readJsonObject(
    request,
    `The ${what} must be a JSON object.`,
  );
  if (!body.ok) throw body.response;
  const input = check(body.value);
  if (!input.ok)
    throw problems.badRequest(`The ${what} is not valid.`, input.errors);
  return input.value;
}

/** A DELETE of one of the person's rows by the id at the end of the path. */
function removal(
  what: string,
  remove: (
    repo: OutboundRepository,
    uid: number,
    id: number,
  ) => Promise<boolean>,
  resolver: CurrentUserResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({ context: personal(resolver) }).on<
    null,
    boolean
  >({
    method: 'DELETE',
    handle: async (_input, { request, uid }) => {
      const id = parseFeedId(idOf(request));
      return id === undefined
        ? false
        : remove(new OutboundRepository(getDatabase()), uid, id);
    },
    encode: (removed) => (removed ? noContent() : problems.notFound(what)),
  });
}

/** The answer when the server has no VAPID keys. */
function pushUnavailable(): Response {
  return problem(
    503,
    '/problems/unavailable',
    'Service unavailable',
    'Push notifications are not set up on this server.',
    { headers: { 'Retry-After': '86400' } },
  );
}

/**
 * `GET /api/push/configuration`: the VAPID public key a browser subscribes
 * with. Public. 503 when the server has none.
 */
export function createPushConfiguration(
  environment: () => { readonly VAPID_PUBLIC_KEY?: string } = getEnv,
): ApiController {
  return new ApiController().on<null, string | undefined>({
    method: 'GET',
    handle: () => environment().VAPID_PUBLIC_KEY || undefined,
    encode: (key) =>
      key
        ? {
            body: { vapid_public_key: key },
            headers: { 'Cache-Control': 'public, max-age=3600' },
          }
        : pushUnavailable(),
  });
}

/** The push-configuration controller bound to the runtime environment. */
export const pushConfiguration = createPushConfiguration();

const pushLocation = (s: PushSubscription) =>
  `/api/users/self/push/subscriptions/${s.id}`;

/**
 * `POST /api/users/self/push/subscriptions` {endpoint, keys}: tell this
 * browser when the day's issue is ready. 201 with its `Location`; 200 when the
 * endpoint was known (now the caller's, with the keys sent); 400 for a body
 * that is not a browser subscription, 415 for a non-JSON body, 401/403 when
 * not signed in or cross-site.
 */
export function createPushSubscriptionsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({ context: personal(resolver) }).on<
    PushSubscriptionInput,
    { subscription: PushSubscription; created: boolean }
  >({
    method: 'POST',
    decode: (request) =>
      decodeWith(request, 'push subscription', parsePushSubscriptionInput),
    handle: (input, { uid }) =>
      new OutboundRepository(getDatabase()).addPushSubscription(uid, input),
    encode: ({ subscription, created: isNew }) => {
      const body = pushSubscriptionResource(subscription);
      return isNew
        ? created(body, pushLocation(subscription))
        : ok(body, { location: pushLocation(subscription) });
    },
  });
}

/** The push-subscription collection bound to the production resolver. */
export const pushSubscriptionsCollection = createPushSubscriptionsCollection();

/**
 * `DELETE /api/users/self/push/subscriptions/:id`: stop telling a browser.
 * 204, 404 when the person has no such subscription.
 */
export const createPushSubscriptionItem = (
  resolver: CurrentUserResolver = requestCookieResolver,
) =>
  removal(
    'push subscription',
    (repo, uid, id) => repo.removePushSubscription(uid, id),
    resolver,
  );

/** The push-subscription item bound to the production resolver. */
export const pushSubscriptionItem = createPushSubscriptionItem();

/**
 * `POST /api/users/self/webhooks` {url, events}: tell an https address about
 * saves and likes. 201 with the hook, its `Location` and, this once, the
 * `secret` deliveries are signed with; 400 or 415 for a bad body.
 */
export function createWebhooksCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({ context: personal(resolver) }).on<
    { url: string; events: Webhook['events'] },
    Webhook
  >({
    method: 'POST',
    decode: (request) => decodeWith(request, 'webhook', parseWebhookInput),
    handle: ({ url, events }, { uid }) =>
      new OutboundRepository(getDatabase()).addWebhook(
        uid,
        url,
        events,
        randomToken(),
      ),
    encode: (hook) =>
      created(
        webhookResource(hook, true),
        `/api/users/self/webhooks/${hook.id}`,
      ),
  });
}

/** The webhook collection bound to the production resolver. */
export const webhooksCollection = createWebhooksCollection();

/** `DELETE /api/users/self/webhooks/:id`: stop the deliveries. 204 or 404. */
export const createWebhookItem = (
  resolver: CurrentUserResolver = requestCookieResolver,
) =>
  removal('webhook', (repo, uid, id) => repo.removeWebhook(uid, id), resolver);

/** The webhook item bound to the production resolver. */
export const webhookItem = createWebhookItem();

/**
 * `POST /api/users/self/tokens` {scope, tag?, section_id?}: a token a feed
 * reader can fetch `/feed.xml` with. 201 with the token's `Location` and,
 * this once, the token and its `feed_url`; 400 for a bad body or a section
 * that is not the person's, 415 for a non-JSON body.
 */
export function createTokensCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({ context: personal(resolver) }).on<
    FeedTokenInput,
    { row: FeedToken; token: string }
  >({
    method: 'POST',
    decode: (request) => decodeWith(request, 'token', parseFeedTokenInput),
    handle: async (input, { uid }) => {
      const db = getDatabase();
      if (
        input.section_id !== undefined &&
        !(await new Repository(db).getSection(uid, input.section_id))
      ) {
        throw problems.badRequest('The token is not valid.', [
          'section_id: must name one of your sections.',
        ]);
      }
      if (
        input.search_id !== undefined &&
        !(await new Repository(db).getSearch(uid, input.search_id))
      ) {
        throw problems.badRequest('The token is not valid.', [
          'search_id: must name one of your saved searches.',
        ]);
      }
      const token = randomToken();
      const row = await new OutboundRepository(db).addFeedToken(
        uid,
        await sha256Hex(token),
        input,
      );
      return { row, token };
    },
    encode: ({ row, token }, { request }) =>
      created(
        feedTokenResource(row, { token, origin: appOrigin(request) }),
        `/api/users/self/tokens/${row.id}`,
      ),
  });
}

/** The token collection bound to the production resolver. */
export const tokensCollection = createTokensCollection();

/** `DELETE /api/users/self/tokens/:id`: revoke a feed token. 204 or 404. */
export const createTokenItem = (
  resolver: CurrentUserResolver = requestCookieResolver,
) =>
  removal('token', (repo, uid, id) => repo.removeFeedToken(uid, id), resolver);

/** The token item bound to the production resolver. */
export const tokenItem = createTokenItem();
