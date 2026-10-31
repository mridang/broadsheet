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
  trendingArticleResource,
  type ArticleQueryInput,
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
  type TrendingQuery,
} from '@/domain/repository';
import { getDatabase } from '@/domain/db/database';

/** The signed-in caller's id and the request, for an article endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** One page of articles, and where the next starts when more follow. */
interface ArticlePage {
  readonly items: readonly unknown[];
  readonly next?: { readonly key: string; readonly id: string };
}

/** A checked query: what the list is ordered and filtered by. */
type CheckedQuery = Extract<ArticleQueryInput, { ok: true }>;

/** The newest-first page of a search. */
async function searchPage(
  repo: Repository,
  uid: number,
  query: ArticleQuery,
): Promise<ArticlePage> {
  const rows = await repo.searchArticles(uid, query);
  const items: ArticleSummary[] = rows.slice(0, query.limit);
  const last = items.at(-1);
  return {
    items: items.map(articleResource),
    ...(rows.length > query.limit && last
      ? { next: { key: String(last.id), id: String(last.id) } }
      : {}),
  };
}

/** A page of the articles most read or saved in the window. */
async function trendingPage(
  repo: Repository,
  uid: number,
  trending: TrendingQuery,
): Promise<ArticlePage> {
  const rows = await repo.trendingArticles(uid, trending);
  const items = rows.slice(0, trending.limit);
  const last = items.at(-1);
  return {
    items: items.map((row) => trendingArticleResource(row, trending.order)),
    ...(rows.length > trending.limit && last
      ? { next: { key: String(last.count), id: String(last.article.id) } }
      : {}),
  };
}

/**
 * `GET /api/articles?q=&order=&window=&cursor=&limit=`: articles from the
 * sources the person follows, from every edition. Newest first by default,
 * and with `q`, only those whose title, summary or text holds every word. With
 * `order=reads` or `order=saves`, ranked instead by how many people read or
 * saved each in the `window` (only counts, never who). 200 with `{self, next?,
 * items}`, 400 for a bad parameter, 401 when not signed in.
 */
export function createArticlesCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<CheckedQuery, ArticlePage>({
    method: 'GET',
    decode: (request) => {
      const input = parseArticleQuery(new URL(request.url).searchParams);
      if (!input.ok) {
        throw problems.badRequest('The search is not valid.', input.errors);
      }
      return input;
    },
    handle: ({ query, trending }, { uid }) => {
      const repo = new Repository(getDatabase());
      return trending
        ? trendingPage(repo, uid, trending)
        : searchPage(repo, uid, query);
    },
    encode: ({ items, next }) =>
      page(items, next, { 'Cache-Control': 'private, no-cache' }),
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
