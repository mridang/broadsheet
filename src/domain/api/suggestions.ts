/**
 * @packageDocumentation
 *
 * Discovering sources: `GET /api/feeds/suggestions` lists the sources that
 * people who share a source with the caller also follow (co-subscription),
 * leaving out the ones the caller follows already. Following one is
 * `POST /api/feeds` with its `url`. After NewsBlur's discover, one feed has
 * its own similar sources (`GET /api/feeds/{id}/similar`, with their newest
 * headlines); an article's similar stories from any source are
 * `GET /api/articles/{id}/similar?scope=all` (see `api/articles`).
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parentIdOf } from '@/domain/api/answers';
import { parseFeedId } from '@/domain/api/feed-resource';
import { ApiController, page, problems } from '@/lib/core/api';
import { getDatabase } from '@/domain/db/database';
import {
  Repository,
  type SimilarSource,
  type SourceSuggestion,
} from '@/domain/repository';

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

/** How many similar sources or stories a list holds at most. */
export const MAX_SIMILAR = 5;

/** A headline of a similar source, linking to its page. */
export interface HeadlineResource {
  readonly article_id: string;
  readonly title?: string;
  readonly href: string;
}

/** A source like one of the caller's feeds, with its newest headlines. */
export interface SimilarSourceResource extends SuggestionResource {
  readonly stories: readonly HeadlineResource[];
}

/** The API's view of a similar source. */
export function similarSourceResource(
  source: SimilarSource,
): SimilarSourceResource {
  return {
    ...suggestionResource(source),
    stories: source.stories.map((s) => ({
      article_id: String(s.id),
      ...(s.title ? { title: s.title } : {}),
      href: `/article/${s.id}`,
    })),
  };
}

/** No-cache, for a personal list. */
const PERSONAL = { 'Cache-Control': 'private, no-cache' };

/**
 * `GET /api/feeds/:id/similar`: up to {@link MAX_SIMILAR} sources that people
 * who follow this feed's source also follow, and the caller does not, each
 * with its newest headlines, as a single page. 404 when the feed is not the
 * caller's, 401 when not signed in.
 */
export function createSimilarFeeds(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<{ readonly request: Request; readonly uid: number }> {
  return new ApiController<{ readonly request: Request; readonly uid: number }>(
    {
      context: async (request) => ({
        request,
        uid: await liveUid(request, resolver),
      }),
    },
  ).on<null, SimilarSource[] | undefined>({
    method: 'GET',
    handle: async (_input, { request, uid }) => {
      const id = parseFeedId(parentIdOf(request));
      return id !== undefined
        ? new Repository(getDatabase()).similarSources(uid, id, MAX_SIMILAR)
        : undefined;
    },
    encode: (items) =>
      items
        ? page(items.map(similarSourceResource), undefined, PERSONAL)
        : problems.notFound('feed'),
  });
}

/** The similar-feeds controller bound to the production resolver. */
export const similarFeeds = createSimilarFeeds();
