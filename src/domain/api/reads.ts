/**
 * @packageDocumentation
 *
 * Read tracking: noting that the signed-in person opened a story, so the
 * paper dims it today and leaves it out of later editions; marking it unread
 * again; and marking a whole feed, section, edition or paper read at once.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import {
  readJsonObject,
  problems,
  ApiController,
  created,
  noContent,
  ok,
} from '@/lib/core/api';
import { Repository } from '@/domain/repository';
import { getDatabase } from '@/domain/db/database';
import { MAX_READ_SECONDS } from '@/domain/trending';

/** The signed-in caller's id and the request, for a read endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/**
 * Note the other copies of these clustered stories as read, when the person
 * asked for that (`cluster_mark_read`).
 */
export async function readCopies(
  repo: Repository,
  uid: number,
  ids: readonly number[],
): Promise<void> {
  if (!(await repo.getPreferences(uid)).cluster_mark_read) return;
  for (const id of ids) {
    for (const sibling of await repo.clusterSiblingIds(uid, id)) {
      await repo.markRead(uid, sibling);
    }
  }
}

/** A read as the API shows it. */
interface ReadResource {
  readonly article_id: string;
  readonly seconds?: number;
}

/** A checked read-time body, or what was wrong with it. */
export type ReadTimeInput =
  | { readonly ok: true; readonly seconds: number }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Check a read-time body: `seconds` a whole number from 0, the time the
 * person spent on the story (more than {@link MAX_READ_SECONDS} counts as
 * that). Other members are refused.
 */
export function parseReadTime(
  body: Readonly<Record<string, unknown>>,
): ReadTimeInput {
  const errors = Object.keys(body)
    .filter((key) => key !== 'seconds')
    .map((key) => `${key}: not a member of a read.`);
  const { seconds } = body;
  if (
    typeof seconds !== 'number' ||
    !Number.isInteger(seconds) ||
    seconds < 0
  ) {
    errors.push('seconds: must be a whole number from 0.');
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, seconds: Math.min(seconds as number, MAX_READ_SECONDS) };
}

/**
 * `POST /api/users/self/reads/:article_id`: note the story as read. 201 with
 * its `Location` the first time, 200 after that, 404 when there is no such
 * article.
 *
 * `PATCH /api/users/self/reads/:article_id` {seconds}: note how long the
 * person spent on it; the longest time recorded stays. 200 with the read,
 * 400 for a bad body, 404 when they have no read of it, 415 for a non-JSON
 * body.
 *
 * `DELETE /api/users/self/reads/:article_id`: mark it unread again. 204, or
 * 404 when it was not read.
 *
 * All answer 401/403 when not signed in or cross-site. With the person's
 * `cluster_mark_read` preference on, a story's other copies (from sources
 * they follow) are noted as read with it.
 */
export function createReadItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<null, { id: number; first: boolean | undefined } | undefined>({
      method: 'POST',
      handle: async (_input, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        if (id === undefined) return undefined;
        const repo = new Repository(getDatabase());
        const first = await repo.markRead(uid, id);
        if (first !== undefined) await readCopies(repo, uid, [id]);
        return { id, first };
      },
      encode: (result) => {
        if (!result || result.first === undefined) {
          return problems.notFound('article');
        }
        const body: ReadResource = { article_id: String(result.id) };
        const at = `/api/users/self/reads/${result.id}`;
        return result.first ? created(body, at) : ok(body, { location: at });
      },
    })
    .on<number, ReadResource | undefined>({
      method: 'PATCH',
      decode: async (request) => {
        const body = await readJsonObject(
          request,
          'The read must be a JSON object.',
        );
        if (!body.ok) throw body.response;
        const input = parseReadTime(body.value);
        if (!input.ok) {
          throw problems.badRequest('The read is not valid.', input.errors);
        }
        return input.seconds;
      },
      handle: async (seconds, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        if (id === undefined) return undefined;
        const stored = await new Repository(getDatabase()).recordReadTime(
          uid,
          id,
          seconds,
        );
        return stored === undefined
          ? undefined
          : { article_id: String(id), seconds: stored };
      },
      encode: (read) =>
        read
          ? ok(read, { headers: { 'Cache-Control': 'no-store' } })
          : problems.notFound('read'),
    })
    .on<null, boolean>({
      method: 'DELETE',
      handle: async (_input, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        return id === undefined
          ? false
          : new Repository(getDatabase()).markUnread(uid, id);
      },
      encode: (removed) => (removed ? noContent() : problems.notFound('read')),
    });
}

/** The read-item controller bound to the production resolver. */
export const readItem = createReadItem();

/** The most ids one bulk mark-read may name: a whole edition fits. */
export const MAX_BULK_READS = 500;

/** Which stories a bulk mark-read covers, as the API takes it. */
interface ReadScopeInput {
  readonly article_ids?: readonly number[];
  readonly feed_ids?: readonly number[];
  readonly section_id?: number;
  readonly edition?: string;
  readonly before?: Date;
  readonly after?: Date;
}

/** A checked bulk mark-read body, or what was wrong with it. */
type ReadScopeBody =
  | { readonly ok: true; readonly scope: ReadScopeInput }
  | { readonly ok: false; readonly errors: readonly string[] };

/** A list of up to {@link MAX_BULK_READS} id strings as numbers, or undefined. */
function ids(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BULK_READS) {
    return undefined;
  }
  const parsed = raw.map((v) =>
    typeof v === 'string' ? parseFeedId(v) : undefined,
  );
  return parsed.every((v) => v !== undefined) ? parsed : undefined;
}

/** An RFC 3339 time, or undefined. */
function time(raw: unknown): Date | undefined {
  if (
    typeof raw !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.test(
      raw,
    )
  ) {
    return undefined;
  }
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

/**
 * Check a bulk mark-read body, which names at least one member, each
 * narrowing the rest:
 * `article_ids` and `feed_ids` lists of ids, `section_id` an id, `edition` a
 * `YYYY-MM-DD` date, `before` and `after` RFC 3339 times. Other members are
 * refused.
 */
export function parseReadScope(
  body: Readonly<Record<string, unknown>>,
): ReadScopeBody {
  const errors: string[] = [];
  const scope: { -readonly [K in keyof ReadScopeInput]: ReadScopeInput[K] } =
    {};
  const known = [
    'article_ids',
    'feed_ids',
    'section_id',
    'edition',
    'before',
    'after',
  ];
  for (const key of Object.keys(body)) {
    if (!known.includes(key)) {
      errors.push(`${key}: not a member of a read scope.`);
    }
  }
  for (const key of ['article_ids', 'feed_ids'] as const) {
    if (body[key] === undefined) continue;
    const list = ids(body[key]);
    if (list) scope[key] = list;
    else errors.push(`${key}: must be a list of 1 to ${MAX_BULK_READS} ids.`);
  }
  if (body['section_id'] !== undefined) {
    const raw = body['section_id'];
    const id = typeof raw === 'string' ? parseFeedId(raw) : undefined;
    if (id === undefined) errors.push('section_id: not a section id.');
    else scope.section_id = id;
  }
  const edition = body['edition'];
  if (edition !== undefined) {
    if (
      typeof edition === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(edition) &&
      !Number.isNaN(Date.parse(edition))
    ) {
      scope.edition = edition;
    } else errors.push('edition: must be a YYYY-MM-DD date.');
  }
  for (const key of ['before', 'after'] as const) {
    if (body[key] === undefined) continue;
    const at = time(body[key]);
    if (at) scope[key] = at;
    else errors.push(`${key}: must be an RFC 3339 time.`);
  }
  if (errors.length === 0 && Object.keys(scope).length === 0) {
    errors.push(
      `A read scope names at least one of ${known.join(', ')}; send before as now to mark everything read.`,
    );
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, scope };
}

/**
 * `POST /api/users/self/reads` {article_ids?, feed_ids?, section_id?,
 * edition?, before?, after?}: mark the person's unread stories read, as
 * NewsBlur's mark-all, mark-feed and mark-stories read: those the members
 * name, each narrowing the rest (`before` as now marks everything). 200 with
 * the stories now read (ids not in the person's feeds are left out), 400 for
 * a body that is not a valid scope or names a feed or section the person does
 * not have, 415 for a non-JSON body, 401/403 when not signed in or
 * cross-site. Their other copies are read too, as for one.
 */
export function createReadsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<ReadScopeInput, readonly number[]>({
    method: 'POST',
    decode: async (request) => {
      const body = await readJsonObject(
        request,
        'The read scope must be a JSON object.',
      );
      if (!body.ok) throw body.response;
      const input = parseReadScope(body.value);
      if (!input.ok) {
        throw problems.badRequest('The read scope is not valid.', input.errors);
      }
      return input.scope;
    },
    handle: async (scope, { uid }) => {
      const repo = new Repository(getDatabase());
      const feeds = await repo.listFeeds(uid);
      const errors: string[] = [];
      const named = scope.feed_ids?.map((id) => feeds.find((f) => f.id === id));
      if (named?.some((f) => !f)) errors.push('feed_ids: no such feed.');
      if (
        scope.section_id !== undefined &&
        !(await repo.getSection(uid, scope.section_id))
      ) {
        errors.push('section_id: no such section.');
      }
      if (errors.length > 0) {
        throw problems.badRequest('The read scope is not valid.', errors);
      }
      const filed =
        scope.section_id === undefined
          ? undefined
          : feeds.filter((f) => f.section_id === scope.section_id);
      const chosen = [named, filed].filter((list) => list !== undefined);
      const sourceIds =
        chosen.length > 0
          ? chosen
              .map((list) => new Set(list.map((f) => f!.source_id)))
              .reduce((a, b) => a.intersection(b))
          : undefined;
      const done = await repo.markAllRead(uid, {
        ...(sourceIds ? { sourceIds: [...sourceIds] } : {}),
        ...(scope.article_ids ? { articleIds: scope.article_ids } : {}),
        ...(scope.edition ? { edition: scope.edition } : {}),
        ...(scope.before ? { before: scope.before } : {}),
        ...(scope.after ? { after: scope.after } : {}),
      });
      await readCopies(repo, uid, done);
      return done;
    },
    encode: (done) =>
      ok(
        {
          items: done.map((id): ReadResource => ({ article_id: String(id) })),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      ),
  });
}

/** The read-collection controller bound to the production resolver. */
export const readsCollection = createReadsCollection();
