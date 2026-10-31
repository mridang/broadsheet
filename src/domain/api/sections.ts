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
import { getDatabase } from '@/domain/db/database';

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
 * `POST /api/sections` {name, position?}: add a section. 201 with it and its
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
    handle: ({ name, position }, { uid }) =>
      new Repository(getDatabase()).addSection(uid, name!, position),
    encode: (section) =>
      created(sectionResource(section), `/api/sections/${section.id}`),
  });
}

/** The section-collection controller bound to the production resolver. */
export const sectionsCollection = createSectionsCollection();

/**
 * `PATCH /api/sections/:id` {name?, position?}: rename or move the section.
 * 200 with it, 400 for a body that is not a valid change, 415 for a non-JSON
 * body.
 *
 * `DELETE /api/sections/:id`: remove the section; its feeds stay, under no
 * section. 204.
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
        return id !== undefined
          ? new Repository(getDatabase()).updateSection(uid, id, changes)
          : undefined;
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
        return id !== undefined
          ? new Repository(getDatabase()).removeSection(uid, id)
          : false;
      },
      encode: (removed) =>
        removed ? noContent() : problems.notFound('section'),
    });
}

/** The section-item controller bound to the production resolver. */
export const sectionItem = createSectionItem();
