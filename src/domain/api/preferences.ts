/**
 * @packageDocumentation
 *
 * The preferences API as a controller over the `core/api` framework: reading
 * and changing what the signed-in person chose about clustering and the
 * editor's note. The resource is edited in place, so it carries an `ETag`
 * and a change may name it in `If-Match`.
 */

import {
  parsePreferenceChanges,
  preferencesResource,
  sourceSection,
  type PreferencesResource,
} from '@/domain/api/preference-resource';
import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import {
  ApiController,
  entityTag,
  ifMatchSatisfied,
  ok,
  problems,
  readJsonObject,
} from '@/lib/core/api';
import { Repository, type Preferences } from '@/domain/repository';
import { getDatabase } from '@/domain/db/client';

/** The signed-in caller's id and the request. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** The representation and its entity tag. */
interface Tagged {
  readonly body: PreferencesResource;
  readonly tag: string;
}

/** Preferences as the API shows them, with their entity tag. */
async function tagged(p: Preferences): Promise<Tagged> {
  const body = preferencesResource(p);
  return { body, tag: await entityTag(JSON.stringify(body)) };
}

/** The response that sends tagged preferences. */
const respond = ({ body, tag }: Tagged) =>
  ok(body, { headers: { 'Cache-Control': 'private, no-cache', ETag: tag } });

/**
 * `GET /api/users/self/preferences`: 200 with the person's preferences (the
 * defaults for what they never changed).
 *
 * `PATCH /api/users/self/preferences`: change some of them. 200 with all of
 * them, 400 naming each bad member (a briefing source must be one of the
 * person's sections), 412 when `If-Match` names an older version.
 *
 * Both answer 401 when not signed in; a cross-site change is 403.
 */
export function createPreferencesItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<null, Tagged>({
      method: 'GET',
      handle: async (_input, { uid }) =>
        tagged(await new Repository(getDatabase()).getPreferences(uid)),
      encode: respond,
    })
    .on<Partial<Preferences>, Tagged>({
      method: 'PATCH',
      decode: async (request) => {
        const body = await readJsonObject(
          request,
          'The change must be a JSON object.',
        );
        if (!body.ok) throw body.response;
        const input = parsePreferenceChanges(body.value);
        if (!input.ok) {
          throw problems.badRequest('The change is not valid.', input.errors);
        }
        return input.changes;
      },
      handle: async (changes, { request, uid }) => {
        const repo = new Repository(getDatabase());
        const section =
          changes.briefing_sources === undefined
            ? undefined
            : sourceSection(changes.briefing_sources);
        if (section !== undefined && !(await repo.getSection(uid, section))) {
          throw problems.badRequest('The change is not valid.', [
            'briefing.sources: no such section.',
          ]);
        }
        const current = await tagged(await repo.getPreferences(uid));
        if (!ifMatchSatisfied(request.headers.get('if-match'), current.tag)) {
          throw problems.preconditionFailed();
        }
        return tagged(await repo.updatePreferences(uid, changes));
      },
      encode: respond,
    });
}

/** The preferences controller bound to the production resolver. */
export const preferencesItem = createPreferencesItem();
