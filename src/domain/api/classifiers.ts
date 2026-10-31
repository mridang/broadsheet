/**
 * @packageDocumentation
 *
 * Training the paper: the person's classifiers, listed, added and removed.
 * Each runs as the signed-in person, as the feed controllers do.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import {
  classifierResource,
  parseClassifierInput,
} from '@/domain/api/classifier-resource';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import { newestPage, pageRequest, type PageRequest } from '@/domain/api/paging';
import {
  readJsonObject,
  problems,
  ApiController,
  ok,
  created,
  noContent,
  page,
  type Slice,
} from '@/lib/core/api';
import {
  Repository,
  type Classifier,
  type ClassifierInput,
} from '@/domain/repository';
import { getDatabase } from '@/domain/db/database';
import { fireWebhooks } from '@/domain/notify';

/** The signed-in caller's id and the request, for a classifier endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

const location = (c: Classifier) => `/api/users/self/classifiers/${c.id}`;

/**
 * `GET /api/users/self/classifiers?limit&cursor`: the person's classifiers,
 * newest first, a page at a time. 400 for a bad limit or cursor.
 *
 * `POST /api/users/self/classifiers` {kind, value, score}: train the paper.
 * 201 with the classifier and its `Location`; 200 with it when one for the
 * same kind and value was there (its score now the one sent); 400 for a body
 * that is not a valid classifier, 415 for a non-JSON body.
 *
 * Both answer 401/403 when not signed in or cross-site.
 */
export function createClassifiersCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<PageRequest, Slice<Classifier>>({
      method: 'GET',
      decode: (request) => pageRequest(request),
      handle: async (paging, { uid }) =>
        newestPage(
          await new Repository(getDatabase()).listClassifiers(uid),
          (c) => ({ key: c.created_at ?? '', id: String(c.id) }),
          paging,
        ),
      encode: (slice) =>
        page(slice.items.map(classifierResource), slice.next, {
          'Cache-Control': 'no-store',
        }),
    })
    .on<ClassifierInput, { classifier: Classifier; created: boolean }>({
      method: 'POST',
      decode: async (request) => {
        const body = await readJsonObject(
          request,
          'The classifier must be a JSON object.',
        );
        if (!body.ok) throw body.response;
        const input = parseClassifierInput(body.value);
        if (!input.ok) {
          throw problems.badRequest(
            'The classifier is not valid.',
            input.errors,
          );
        }
        return input.input;
      },
      handle: async (input, { uid }) => {
        const result = await new Repository(getDatabase()).addClassifier(
          uid,
          input,
        );
        if (result.classifier.score > 0) {
          fireWebhooks(uid, 'like', classifierResource(result.classifier));
        }
        return result;
      },
      encode: (result) =>
        result.created
          ? created(
              classifierResource(result.classifier),
              location(result.classifier),
            )
          : ok(classifierResource(result.classifier), {
              location: location(result.classifier),
            }),
    });
}

/** The classifier-collection controller bound to the production resolver. */
export const classifiersCollection = createClassifiersCollection();

/**
 * `DELETE /api/users/self/classifiers/:id`: forget a classifier. 204, 404 when
 * the person has no such classifier (or the id cannot name one), 401/403 when
 * not signed in or cross-site.
 */
export function createClassifierItem(
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
      return id !== undefined
        ? new Repository(getDatabase()).removeClassifier(uid, id)
        : false;
    },
    encode: (removed) =>
      removed ? noContent() : problems.notFound('classifier'),
  });
}

/** The classifier-item controller bound to the production resolver. */
export const classifierItem = createClassifierItem();
