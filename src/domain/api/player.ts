/**
 * @packageDocumentation
 *
 * The signed-in person's listening player as a REST resource: NewsBlur's
 * playback state, media queue and history in one document.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parsePlayerInput, playerResource } from '@/domain/api/player-resource';
import { getDatabase } from '@/domain/db/client';
import { PlayerRepository, type PlayerState } from '@/domain/player';
import {
  ApiController,
  noContent,
  ok,
  problems,
  readJsonObject,
} from '@/lib/core/api';

/** The signed-in caller's id and the request. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/**
 * `GET /api/users/self/player`: the person's rate, current story and
 * position, queue and history (the empty player when they never listened).
 *
 * `PUT /api/users/self/player` {rate, current, queue, history}: replace it.
 * 200 with what is stored; 400/415 for a bad body.
 *
 * `DELETE /api/users/self/player`: forget it. 204, or 404 when there was none.
 *
 * All answer 401/403 when not signed in or cross-site.
 */
export function createPlayerItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<null, PlayerState>({
      method: 'GET',
      handle: (_input, { uid }) => new PlayerRepository(getDatabase()).get(uid),
      encode: (state) => ok(playerResource(state)),
    })
    .on<PlayerState, PlayerState>({
      method: 'PUT',
      decode: async (request) => {
        const body = await readJsonObject(
          request,
          'The player must be a JSON object.',
        );
        if (!body.ok) throw body.response;
        const input = parsePlayerInput(body.value);
        if (!input.ok) {
          throw problems.badRequest('The player is not valid.', input.errors);
        }
        return input.value;
      },
      handle: async (state, { uid }) => {
        await new PlayerRepository(getDatabase()).put(uid, state);
        return state;
      },
      encode: (state) => ok(playerResource(state)),
    })
    .on<null, boolean>({
      method: 'DELETE',
      handle: (_input, { uid }) =>
        new PlayerRepository(getDatabase()).clear(uid),
      encode: (removed) =>
        removed ? noContent() : problems.notFound('player'),
    });
}

/** The player controller bound to the production resolver. */
export const playerItem = createPlayerItem();
