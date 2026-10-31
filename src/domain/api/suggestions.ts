/**
 * @packageDocumentation
 *
 * Discovering sources: `GET /api/feeds/suggestions` lists the sources that
 * people who share a source with the caller also follow (co-subscription),
 * leaving out the ones the caller follows already. Following one is
 * `POST /api/feeds` with its `url`.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { ApiController, page } from '@/lib/core/api';
import { getDatabase } from '@/domain/db/database';
import { Repository, type SourceSuggestion } from '@/domain/repository';

/** How many suggestions a list holds at most. */
export const MAX_SUGGESTIONS = 10;

/** A suggested source on the wire. */
export interface SuggestionResource {
  readonly url: string;
  readonly title?: string;
  /** How many of the people who share a source with the caller follow this one. */
  readonly followers: number;
}

/** The API's view of a suggested source. */
export function suggestionResource(
  suggestion: SourceSuggestion,
): SuggestionResource {
  return {
    url: suggestion.url,
    ...(suggestion.title ? { title: suggestion.title } : {}),
    followers: suggestion.followers,
  };
}

/**
 * `GET /api/feeds/suggestions`: up to {@link MAX_SUGGESTIONS} sources, most
 * shared first, as a single page. 401 when not signed in.
 */
export function createSuggestionsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<{ readonly uid: number }> {
  return new ApiController<{ readonly uid: number }>({
    context: async (request) => ({ uid: await liveUid(request, resolver) }),
  }).on<null, SourceSuggestion[]>({
    method: 'GET',
    handle: (_input, { uid }) =>
      new Repository(getDatabase()).suggestSources(uid, MAX_SUGGESTIONS),
    encode: (items) =>
      page(items.map(suggestionResource), undefined, {
        'Cache-Control': 'private, no-cache',
      }),
  });
}

/** The suggestions controller bound to the production resolver. */
export const suggestionsCollection = createSuggestionsCollection();
