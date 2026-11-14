/**
 * @packageDocumentation
 *
 * The custom-edition API as controllers over the `core/api` framework:
 * adding, changing and removing the named papers a person keeps beside their
 * default one, and reading one day's issue of one. Each runs as the signed-in
 * person and answers 404 for an edition that is not theirs.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import {
  editionResource,
  parseEditionInput,
} from '@/domain/api/edition-resource';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import { issueResource } from '@/domain/api/issue-resource';
import {
  readJsonObject,
  problems,
  ApiController,
  ok,
  created,
  noContent,
} from '@/lib/core/api';
import {
  Repository,
  type CustomEdition,
  type EditionChanges,
} from '@/domain/repository';
import { getDatabase } from '@/domain/db/client';
import { isIssueDate, storedEditionIssue, type Issue } from '@/domain/issues';

/** The signed-in caller's id and the request, for an edition endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** Read and check an edition body; a bad one is thrown as its problem. */
async function decodeEdition(
  request: Request,
  required: boolean,
): Promise<EditionChanges> {
  const body = await readJsonObject(
    request,
    'The edition must be a JSON object.',
  );
  if (!body.ok) {
    throw body.response;
  }
  const input = parseEditionInput(body.value, required);
  if (!input.ok) {
    throw problems.badRequest('The edition is not valid.', input.errors);
  }
  return input.changes;
}

/** Refuse sections that are not the caller's, as a 400 naming them. */
async function checkSections(
  repo: Repository,
  uid: number,
  changes: EditionChanges,
): Promise<void> {
  if (!changes.section_ids?.length) return;
  const sections = await repo.listSections(uid);
  const own = new Set(sections.map((s) => s.id));
  const foreign = changes.section_ids.filter((id) => !own.has(id));
  if (foreign.length > 0) {
    throw problems.badRequest(
      'The edition is not valid.',
      foreign.map((id) => `section_ids: no section ${id}.`),
    );
  }
}

/** The edition id in `/api/editions/{id}/...`, when it can name one. */
export function editionIdOf(request: Request): number | undefined {
  const segments = new URL(request.url).pathname.split('/');
  return parseFeedId(segments[3] ?? '');
}

/**
 * `POST /api/editions` {name, section_ids?, query?, tag?}: add a custom
 * edition. 201 with it and its `Location`, 400 for a body that is not a valid
 * edition (or names a section that is not the caller's), 401/403 when not
 * signed in or cross-site, 415 for a non-JSON body.
 */
export function createEditionsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<EditionChanges, CustomEdition>({
    method: 'POST',
    decode: (request) => decodeEdition(request, true),
    handle: async (changes, { uid }) => {
      const repo = new Repository(getDatabase());
      await checkSections(repo, uid, changes);
      return repo.addCustomEdition(uid, { ...changes, name: changes.name! });
    },
    encode: (edition) =>
      created(editionResource(edition), `/api/editions/${edition.id}`),
  });
}

/** The edition-collection controller bound to the production resolver. */
export const editionsCollection = createEditionsCollection();

/**
 * `PATCH /api/editions/:id` {name?, section_ids?, query?, tag?}: change the
 * edition's name or rules. 200 with it, 400 for a body that is not a valid
 * change, 415 for a non-JSON body.
 *
 * `DELETE /api/editions/:id`: remove the edition and its issues. 204.
 *
 * Both answer 404 when the caller has no such edition (or the id cannot name
 * one, as `self` cannot), and 401/403 when not signed in or cross-site.
 */
export function createEditionItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<EditionChanges, CustomEdition | undefined>({
      method: 'PATCH',
      decode: (request) => decodeEdition(request, false),
      handle: async (changes, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        if (id === undefined) return undefined;
        const repo = new Repository(getDatabase());
        if (!(await repo.getCustomEdition(uid, id))) return undefined;
        await checkSections(repo, uid, changes);
        return repo.updateCustomEdition(uid, id, changes);
      },
      encode: (edition) =>
        edition
          ? ok(editionResource(edition), {
              headers: { 'Cache-Control': 'no-store' },
            })
          : problems.notFound('edition'),
    })
    .on<null, boolean>({
      method: 'DELETE',
      handle: async (_input, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        return id === undefined
          ? false
          : new Repository(getDatabase()).removeCustomEdition(uid, id);
      },
      encode: (removed) =>
        removed ? noContent() : problems.notFound('edition'),
    });
}

/** The edition-item controller bound to the production resolver. */
export const editionItem = createEditionItem();

/**
 * `GET /api/editions/:id/issues/:date`: the stored issue of one of the
 * caller's custom editions for that day. 200, 404 when the caller has no such
 * edition, no issue was laid out that day, or the date is not a calendar
 * date; 401 when not signed in.
 */
export function createEditionIssueItem(
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
      const id = editionIdOf(request);
      const date = idOf(request);
      if (id === undefined || !isIssueDate(date)) return undefined;
      const repo = new Repository(getDatabase());
      return (await repo.getCustomEdition(uid, id))
        ? storedEditionIssue(repo, id, date)
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

/** The edition-issue controller bound to the production resolver. */
export const editionIssueItem = createEditionIssueItem();
