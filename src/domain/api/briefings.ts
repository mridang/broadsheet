/**
 * @packageDocumentation
 *
 * The briefing API as controllers over the `core/api` framework: listing the
 * signed-in person's briefings, reading one, and asking for one now (for the
 * slot of their day they are in), all from their default edition (`self`).
 * Operators named in `ADMIN_EMAILS` may list everyone's.
 */

import {
  briefingAuditResource,
  briefingResource,
  parseBriefingQuery,
  type BriefingQuery,
} from '@/domain/api/briefing-resource';
import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import { parseBriefedStories } from '@/domain/briefing';
import {
  currentSlot,
  localTime,
  writeScheduledBriefing,
  type Written,
} from '@/domain/briefings';
import { getDatabase } from '@/domain/db/database';
import {
  Repository,
  type Article,
  type StoredBriefing,
} from '@/domain/repository';
import { ApiController, created, ok, page, problems } from '@/lib/core/api';
import { getEnv } from '@/lib/core/runtime';

/** The signed-in caller's id and the request. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** Writes a person's briefing for the slot they are in now. */
export type BriefingWriter = (userId: number) => Promise<Written>;

/** The production writer: Workers AI and D1 from the Worker's bindings. */
const writeNow: BriefingWriter = async (userId) => {
  const db = getDatabase();
  const now = new Date();
  const { timezone } = await new Repository(db).getPreferences(userId);
  return writeScheduledBriefing(
    db,
    getEnv(),
    userId,
    currentSlot(now, timezone),
    localTime(now, timezone).date,
    now,
  );
};

/** A briefing with the articles it covers and which the person read. */
interface Shown {
  readonly briefing: StoredBriefing;
  readonly articles: ReadonlyMap<number, Article>;
  readonly read: ReadonlySet<number>;
}

/** What the API shows of these briefings, for the person `uid`. */
async function show(
  repo: Repository,
  uid: number,
  list: readonly StoredBriefing[],
): Promise<Shown[]> {
  const ids = list.flatMap((b) =>
    parseBriefedStories(b.stories).map((s) => s.id),
  );
  const [rows, reads] = await Promise.all([
    repo.articlesByIds(ids),
    repo.readState(uid),
  ]);
  const articles = new Map(rows.map((a) => [a.id, a]));
  return list.map((briefing) => ({ briefing, articles, read: reads.ids }));
}

/** One page of briefings, and the last of them when more follow. */
interface BriefingPage {
  readonly items: readonly Shown[];
  readonly last?: StoredBriefing;
}

/** Ask the repository for one more than a page, to know if more follow. */
async function pageOf(
  repo: Repository,
  userId: number | undefined,
  query: BriefingQuery,
): Promise<{ items: StoredBriefing[]; last?: StoredBriefing }> {
  const rows = await repo.listBriefings(userId, query.limit + 1, query.before);
  const items = rows.slice(0, query.limit);
  return rows.length > query.limit ? { items, last: items.at(-1) } : { items };
}

/** Decode a list query, or refuse it. */
const decodeQuery = (request: Request): BriefingQuery => {
  const input = parseBriefingQuery(new URL(request.url).searchParams);
  if (!input.ok)
    throw problems.badRequest('The list is not valid.', input.errors);
  return input.query;
};

/** The cursor for the page after `last`. */
const after = (last?: StoredBriefing) =>
  last ? { key: String(last.id), id: String(last.id) } : undefined;

/**
 * `GET /api/editions/self/briefings?cursor=&limit=`: the person's briefings,
 * newest first. 200 with `{self, next?, items}`, 400 for a bad parameter.
 *
 * `POST /api/editions/self/briefings`: write a briefing now, for the slot of
 * the person's day they are in. 201 with it and its `Location`, 200 when it
 * replaced that slot's briefing, 404 when too few stories qualify.
 *
 * Both answer 401 when not signed in; a cross-site POST is 403.
 */
export function createBriefingsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
  write: BriefingWriter = writeNow,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<BriefingQuery, BriefingPage>({
      method: 'GET',
      decode: decodeQuery,
      handle: async (query, { uid }) => {
        const repo = new Repository(getDatabase());
        const { items, last } = await pageOf(repo, uid, query);
        return { items: await show(repo, uid, items), last };
      },
      encode: ({ items, last }) =>
        page(
          items.map((s) => briefingResource(s.briefing, s.articles, s.read)),
          after(last),
          { 'Cache-Control': 'private, no-cache' },
        ),
    })
    .on<null, { shown?: Shown; replaced: boolean }>({
      method: 'POST',
      handle: async (_input, { uid }) => {
        const { briefing, replaced } = await write(uid);
        if (!briefing) return { replaced };
        const [shown] = await show(new Repository(getDatabase()), uid, [
          briefing,
        ]);
        return { shown, replaced };
      },
      encode: ({ shown, replaced }) => {
        if (!shown) return problems.notFound('stories for a briefing');
        const body = briefingResource(
          shown.briefing,
          shown.articles,
          shown.read,
        );
        const at = `/api/editions/self/briefings/${shown.briefing.id}`;
        return replaced ? ok(body, { location: at }) : created(body, at);
      },
    });
}

/** The briefing-collection controller bound to production. */
export const briefingsCollection = createBriefingsCollection();

/**
 * `GET /api/editions/self/briefings/:id`: one of the person's briefings. 200,
 * 404 when there is no such briefing of theirs, 401 when not signed in.
 */
export function createBriefingItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, Shown | undefined>({
    method: 'GET',
    handle: async (_input, { request, uid }) => {
      const id = parseFeedId(idOf(request));
      if (id === undefined) return undefined;
      const repo = new Repository(getDatabase());
      const briefing = await repo.getBriefing(uid, id);
      return briefing ? (await show(repo, uid, [briefing]))[0] : undefined;
    },
    encode: (shown) =>
      shown
        ? ok(briefingResource(shown.briefing, shown.articles, shown.read), {
            headers: { 'Cache-Control': 'private, no-cache' },
          })
        : problems.notFound('briefing'),
  });
}

/** The briefing-item controller bound to the production resolver. */
export const briefingItem = createBriefingItem();

/** The operators' addresses, from the comma-separated `ADMIN_EMAILS`. */
function operators(list: string | undefined): Set<string> {
  return new Set(
    (list ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Briefings with the email of whose each is. */
interface AuditPage {
  readonly items: readonly { b: StoredBriefing; email?: string }[];
  readonly last?: StoredBriefing;
}

/**
 * `GET /api/briefings?cursor=&limit=`: everyone's briefings, newest first,
 * for an operator (a signed-in person whose email is in `ADMIN_EMAILS`).
 * 200 with `{self, next?, items}`, 400 for a bad parameter, 401 when not
 * signed in, 403 for anyone else.
 */
export function createBriefingAudit(
  resolver: CurrentUserResolver = requestCookieResolver,
  admins: () => string | undefined = () =>
    (getEnv() as { ADMIN_EMAILS?: string }).ADMIN_EMAILS,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<BriefingQuery, AuditPage>({
    method: 'GET',
    decode: decodeQuery,
    handle: async (query, { uid }) => {
      const repo = new Repository(getDatabase());
      const me = await repo.getUser(uid);
      if (!me || !operators(admins()).has(me.email.toLowerCase())) {
        throw problems.forbidden('Only an operator may list every briefing.');
      }
      const { items, last } = await pageOf(repo, undefined, query);
      const emails = new Map<number, string>();
      for (const id of new Set(items.map((b) => b.user_id))) {
        const user = await repo.getUser(id);
        if (user) emails.set(id, user.email);
      }
      return {
        items: items.map((b) => ({ b, email: emails.get(b.user_id) })),
        last,
      };
    },
    encode: ({ items, last }) =>
      page(
        items.map(({ b, email }) => briefingAuditResource(b, email)),
        after(last),
        { 'Cache-Control': 'private, no-cache' },
      ),
  });
}

/** The operator's briefing list bound to production. */
export const briefingAudit = createBriefingAudit();
