/**
 * @packageDocumentation
 *
 * Read tracking: noting that the signed-in person opened a story, so the
 * paper dims it today and leaves it out of later editions.
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
}

/**
 * `POST /api/users/self/reads/:article_id`: note the story as read. 201 with
 * its `Location` the first time, 200 after that, 404 when there is no such
 * article.
 *
 * `DELETE /api/users/self/reads/:article_id`: mark it unread again. 204, or
 * 404 when it was not read.
 *
 * Both answer 401/403 when not signed in or cross-site. With the person's
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
    .on<null, boolean>({
      method: 'DELETE',
      handle: async (_input, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        return id !== undefined
          ? new Repository(getDatabase()).markUnread(uid, id)
          : false;
      },
      encode: (removed) => (removed ? noContent() : problems.notFound('read')),
    });
}

/** The read-item controller bound to the production resolver. */
export const readItem = createReadItem();

/** The most stories one request may mark read: a whole edition fits. */
export const MAX_BULK_READS = 500;

/**
 * The article ids in a bulk-read body (`{"article_ids": ["1", "2"]}`), or the
 * sentence saying what is wrong with it.
 */
export function parseBulkReads(
  body: Readonly<Record<string, unknown>>,
): { ok: true; ids: number[] } | { ok: false; error: string } {
  const raw = body['article_ids'];
  if (!Array.isArray(raw) || !raw.length) {
    return { ok: false, error: 'article_ids must be a non-empty array.' };
  }
  if (raw.length > MAX_BULK_READS) {
    return {
      ok: false,
      error: `article_ids may hold at most ${MAX_BULK_READS} ids.`,
    };
  }
  const ids = raw.map((v) =>
    typeof v === 'string' ? parseFeedId(v) : undefined,
  );
  if (ids.some((id) => id === undefined)) {
    return { ok: false, error: 'Each article id must be a string id.' };
  }
  return { ok: true, ids: ids as number[] };
}

/**
 * `POST /api/users/self/reads`: note many stories read at once. 200 with the
 * ids now read (unknown ones are left out), 400 for a bad body, 401/403 when
 * not signed in or cross-site. Their other copies are read too, as for one.
 */
export function createReadsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<number[], number[]>({
    method: 'POST',
    decode: async (request) => {
      const body = await readJsonObject(
        request,
        'The reads must be a JSON object.',
      );
      if (!body.ok) throw body.response;
      const parsed = parseBulkReads(body.value);
      if (!parsed.ok) throw problems.badRequest(parsed.error);
      return parsed.ids;
    },
    handle: async (ids, { uid }) => {
      const repo = new Repository(getDatabase());
      const done = await repo.markManyRead(uid, ids);
      await readCopies(repo, uid, done);
      return done;
    },
    encode: (done) =>
      ok({
        items: done.map((id): ReadResource => ({ article_id: String(id) })),
      }),
  });
}

/** The reads-collection controller bound to the production resolver. */
export const readsCollection = createReadsCollection();
