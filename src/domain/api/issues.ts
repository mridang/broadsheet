/**
 * @packageDocumentation
 *
 * The issue API as controllers over the `core/api` framework: listing the
 * papers the signed-in person was given, reading one day's, and asking for a
 * day to be laid out again (with a fresh editor's note), all from their
 * default edition (`self`; custom editions take their own id in the same
 * place).
 */

import {
  issueResource,
  issueSummaryResource,
  parseIssueQuery,
  parseIssueRequest,
  type IssueQuery,
} from '@/domain/api/issue-resource';
import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { idOf } from '@/domain/api/feeds';
import {
  problems,
  ApiController,
  created,
  ok,
  page,
  readJsonObject,
} from '@/lib/core/api';
import { Repository, type IssueListing } from '@/domain/repository';
import { getDatabase } from '@/domain/db/database';
import {
  isIssueDate,
  publishIssue,
  storedIssue,
  type Issue,
} from '@/domain/issues';
import { getEnv } from '@/lib/core/runtime';

/** Lays out and stores one person's issue for a day, with its note. */
export type Publisher = (userId: number, date: string) => Promise<unknown>;

/** The production publisher: Workers AI and D1 from the Worker's bindings. */
const publishWithEnv: Publisher = (userId, date) =>
  publishIssue(getDatabase(), getEnv(), userId, date);

/** The signed-in caller's id and the request, for an issue endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/**
 * `GET /api/editions/self/issues/:date`: the stored issue of the person's
 * default edition for that day. 200, 404 when no issue was laid out that day
 * (or the date is not a calendar date), 401 when not signed in.
 */
export function createIssueItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, Issue | undefined>({
    method: 'GET',
    handle: async (_input, { request, uid }) => {
      const date = idOf(request);
      return isIssueDate(date)
        ? storedIssue(new Repository(getDatabase()), uid, date)
        : undefined;
    },
    encode: (issue) =>
      issue
        ? ok(issueResource(issue), {
            headers: { 'Cache-Control': 'private, no-cache' },
          })
        : problems.notFound('issue'),
  });
}

/** The issue-item controller bound to the production resolver. */
export const issueItem = createIssueItem();

/** One page of issues, and the last of them when more follow. */
interface IssuePage {
  readonly items: readonly IssueListing[];
  readonly last?: IssueListing;
}

/** What laying an issue out did: the issue, and whether one existed before. */
interface Published {
  readonly issue: Issue | undefined;
  readonly replaced: boolean;
}

/**
 * `GET /api/editions/self/issues?cursor=&limit=`: the person's stored issues,
 * newest first. 200 with `{self, next?, items}`, 400 for a bad parameter.
 *
 * `POST /api/editions/self/issues` `{date}`: lay that day out again and write
 * a fresh editor's note. 201 with the issue and its `Location`, or 200 when
 * it replaced one; 400 for a bad body, 404 when the person has no edition
 * that day.
 *
 * Both answer 401 when not signed in; a cross-site POST is 403.
 */
export function createIssuesCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
  publish: Publisher = publishWithEnv,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<IssueQuery, IssuePage>({
      method: 'GET',
      decode: (request) => {
        const input = parseIssueQuery(new URL(request.url).searchParams);
        if (!input.ok) {
          throw problems.badRequest('The list is not valid.', input.errors);
        }
        return input.query;
      },
      handle: async (query, { uid }) => {
        const rows = await new Repository(getDatabase()).listIssues(
          uid,
          query.limit + 1,
          query.before,
        );
        const items = rows.slice(0, query.limit);
        return rows.length > query.limit
          ? { items, last: items.at(-1) }
          : { items };
      },
      encode: ({ items, last }) =>
        page(
          items.map(issueSummaryResource),
          last ? { key: last.date, id: last.date } : undefined,
          { 'Cache-Control': 'private, no-cache' },
        ),
    })
    .on<string, Published>({
      method: 'POST',
      decode: async (request) => {
        const body = await readJsonObject(
          request,
          'The request must be a JSON object.',
        );
        if (!body.ok) throw body.response;
        const input = parseIssueRequest(body.value);
        if (!input.ok) {
          throw problems.badRequest('The request is not valid.', input.errors);
        }
        return input.date;
      },
      handle: async (date, { uid }) => {
        const repo = new Repository(getDatabase());
        if (!(await repo.listEditions(uid)).includes(date)) {
          return { issue: undefined, replaced: false };
        }
        const replaced = (await repo.getIssue(uid, date)) !== undefined;
        await publish(uid, date);
        return { issue: await storedIssue(repo, uid, date), replaced };
      },
      encode: ({ issue, replaced }) => {
        if (!issue) return problems.notFound('edition');
        const at = `/api/editions/self/issues/${issue.date}`;
        return replaced
          ? ok(issueResource(issue), { location: at })
          : created(issueResource(issue), at);
      },
    });
}

/** The issue-collection controller bound to production. */
export const issuesCollection = createIssuesCollection();
