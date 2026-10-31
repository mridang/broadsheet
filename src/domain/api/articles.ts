/**
 * @packageDocumentation
 *
 * The article API as controllers over the `core/api` framework: searching the
 * archive of every edition, and reading one article with its text. Each runs
 * as the signed-in person and shows only articles from sources they follow.
 */

import {
  articleDetailResource,
  articleResource,
  parseArticleQuery,
} from '@/domain/api/article-resource';
import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import { problems, ApiController, ok, page } from '@/lib/core/api';
import {
  Repository,
  type Article,
  type ArticleQuery,
  type ArticleSummary,
} from '@/domain/repository';
import { getDatabase } from '@/domain/db/database';

/** The signed-in caller's id and the request, for an article endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** One page of articles, and the last of them when more follow. */
interface ArticlePage {
  readonly items: readonly ArticleSummary[];
  readonly last?: ArticleSummary;
}

/**
 * `GET /api/articles?q=&cursor=&limit=`: articles from the sources the person
 * follows, from every edition, newest first; with `q`, only those whose title,
 * summary or text holds every word. 200 with `{self, next?, items}`, 400 for a
 * bad parameter, 401 when not signed in.
 */
export function createArticlesCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<ArticleQuery, ArticlePage>({
    method: 'GET',
    decode: (request) => {
      const input = parseArticleQuery(new URL(request.url).searchParams);
      if (!input.ok) {
        throw problems.badRequest('The search is not valid.', input.errors);
      }
      return input.query;
    },
    handle: async (query, { uid }) => {
      const rows = await new Repository(getDatabase()).searchArticles(
        uid,
        query,
      );
      const items = rows.slice(0, query.limit);
      return rows.length > query.limit
        ? { items, last: items.at(-1) }
        : { items };
    },
    encode: ({ items, last }) =>
      page(
        items.map(articleResource),
        last ? { key: String(last.id), id: String(last.id) } : undefined,
        { 'Cache-Control': 'private, no-cache' },
      ),
  });
}

/** The article-collection controller bound to the production resolver. */
export const articlesCollection = createArticlesCollection();

/**
 * `GET /api/articles/:id`: one article with its text. 200, 404 when there is no
 * such article among the sources the person follows (or the id cannot name
 * one), 401 when not signed in.
 */
export function createArticleItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, Article | undefined>({
    method: 'GET',
    handle: async (_input, { request, uid }) => {
      const id = parseFeedId(idOf(request));
      return id !== undefined
        ? new Repository(getDatabase()).getArticle(uid, id)
        : undefined;
    },
    encode: (article) =>
      article
        ? ok(articleDetailResource(article), {
            headers: { 'Cache-Control': 'private, no-cache' },
          })
        : problems.notFound('article'),
  });
}

/** The article-item controller bound to the production resolver. */
export const articleItem = createArticleItem();
