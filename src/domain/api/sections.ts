/**
 * @packageDocumentation
 *
 * The section API as controllers over the `core/api` framework: adding,
 * changing and removing the headings a person groups their feeds under. Each
 * runs as the signed-in person, as the feed controllers do.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import {
  parseSectionInput,
  sectionResource,
} from '@/domain/api/section-resource';
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
  type Section,
  type SectionChanges,
} from '@/domain/repository';
import { getDatabase } from '@/domain/db/client';

/** The signed-in caller's id and the request, for a section endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** Read and check a section body; a bad one is thrown as its problem. */
async function decodeSection(
  request: Request,
  required: boolean,
): Promise<SectionChanges> {
  const body = await readJsonObject(
    request,
    'The section must be a JSON object.',
  );
  if (!body.ok) {
    throw body.response;
  }
  const input = parseSectionInput(body.value, required);
  if (!input.ok) {
    throw problems.badRequest('The section is not valid.', input.errors);
  }
  return input.changes;
}

/**
 * Whether a `DELETE` asks to unfollow the section's feeds too
 * (`?feeds=unfollow`), as deleting a NewsBlur folder does. Any other value of
 * `feeds` is refused.
 */
function unfollowsFeeds(request: Request): boolean {
  const feeds = new URL(request.url).searchParams.get('feeds');
  if (feeds === null || feeds === 'keep') return false;
  if (feeds === 'unfollow') return true;
  throw problems.badRequest('The removal is not valid.', [
    'feeds: must be keep or unfollow.',
  ]);
}

/** The refusal of a parent that is not the person's, or would make a loop. */
function noSuchParent(): Response {
  return problems.badRequest('The section is not valid.', [
    'parent_id: not one of your sections, or the section itself or one inside it.',
  ]);
}

/**
 * `POST /api/sections` {name, position?, parent_id?}: add a section, nested
 * under `parent_id` when given. 201 with it and its
 * `Location`, 400 for a body that is not a valid section, 401/403 when not
 * signed in or cross-site, 415 for a non-JSON body.
 */
export function createSectionsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<SectionChanges, Section>({
    method: 'POST',
    decode: (request) => decodeSection(request, true),
    handle: async (
      { name, position, parent_id: parent, ...settings },
      { uid },
    ) => {
      const repo = new Repository(getDatabase());
      if (
        parent != null &&
        !(await repo.canNestUnder(uid, undefined, parent))
      ) {
        throw noSuchParent();
      }
      const section = await repo.addSection(
        uid,
        name!,
        position,
        parent ?? null,
      );
      return Object.keys(settings).length > 0
        ? ((await repo.updateSection(uid, section.id, settings)) ?? section)
        : section;
    },
    encode: (section) =>
      created(sectionResource(section), `/api/sections/${section.id}`),
  });
}

/** The section-collection controller bound to the production resolver. */
export const sectionsCollection = createSectionsCollection();

/**
 * `PATCH /api/sections/:id` {name?, position?, parent_id?}: rename, reorder
 * or move the section under another (null for the top level); a parent that
 * is the section itself or inside it is a 400.
 * 200 with it, 400 for a body that is not a valid change, 415 for a non-JSON
 * body.
 *
 * `DELETE /api/sections/:id`: remove the section; its feeds stay, under their
 * other sections or none, and the sections in it move up to its parent. With
 * `?feeds=unfollow` the sections in it go too, with every feed filed only
 * inside them. 204, 400 for another `feeds` value.
 *
 * Both answer 404 when there is no such section (or the id cannot name one),
 * and 401/403 when not signed in or cross-site.
 */
export function createSectionItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<SectionChanges, Section | undefined>({
      method: 'PATCH',
      decode: (request) => decodeSection(request, false),
      handle: async (changes, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        const repo = new Repository(getDatabase());
        if (id === undefined || !(await repo.getSection(uid, id))) {
          return undefined;
        }
        if (
          typeof changes.parent_id === 'number' &&
          !(await repo.canNestUnder(uid, id, changes.parent_id))
        ) {
          throw noSuchParent();
        }
        return repo.updateSection(uid, id, changes);
      },
      encode: (section) =>
        section
          ? ok(sectionResource(section), {
              headers: { 'Cache-Control': 'no-store' },
            })
          : problems.notFound('section'),
    })
    .on<null, boolean>({
      method: 'DELETE',
      handle: async (_input, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        return id === undefined
          ? false
          : new Repository(getDatabase()).removeSection(
              uid,
              id,
              unfollowsFeeds(request),
            );
      },
      encode: (removed) =>
        removed ? noContent() : problems.notFound('section'),
    });
}

/** The section-item controller bound to the production resolver. */
export const sectionItem = createSectionItem();
