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
  type ArticleResource,
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
  type DiscoveredArticle,
  type TrendingQuery,
} from '@/domain/repository';
import { getDatabase } from '@/domain/db/database';
import { withText } from '@/domain/scraping/index';

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
    items: items.map((item) => articleResource(item)),
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
      ? { next: { key: String(last.position), id: String(last.article.id) } }
      : {}),
  };
}

/**
 * `GET /api/articles?q=&order=&window=&cursor=&limit=`: articles from the
 * sources the person follows, from every edition. Newest first by default,
 * and with `q`, only those whose title, summary, text, author or tags hold
 * every word (`author:` and `tag:` terms only that field, as NewsBlur's). With
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
      if (id === undefined) return undefined;
      const db = getDatabase();
      const article = await new Repository(db).getArticle(uid, id);
      return article && withText(db, article);
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

/** The `{id}` of `/api/articles/{id}/...`: the segment before the last. */
function articleIdOf(request: Request): number | undefined {
  const segments = new URL(request.url).pathname.split('/');
  return parseFeedId(segments.at(-2) ?? '');
}

/** How many similar stories `/similar` lists. */
const SIMILAR = 10;

/** Where `/similar` looks: the person's own sources, or every source (discover). */
type SimilarScope = 'followed' | 'all';

/** A similar story from any source, saying whether the person follows it. */
export interface DiscoveredArticleResource extends ArticleResource {
  readonly source_url: string;
  readonly followed: boolean;
}

/** The API's view of a story found by discover. */
export function discoveredArticleResource(
  found: DiscoveredArticle,
): DiscoveredArticleResource {
  return {
    ...articleResource(found.article),
    source_url: found.source_url,
    followed: found.followed,
  };
}

/** The `scope` of a `/similar` request, or the 400 for a bad one. */
function similarScope(request: Request): SimilarScope {
  const params = new URL(request.url).searchParams;
  const errors = [...new Set(params.keys())]
    .filter((key) => key !== 'scope')
    .map((key) => `${key}: not a parameter of this list.`);
  const scope = params.get('scope') ?? 'followed';
  if (scope !== 'followed' && scope !== 'all') {
    errors.push('scope: followed or all.');
  }
  if (errors.length > 0) {
    throw problems.badRequest('The request is not valid.', errors);
  }
  return scope as SimilarScope;
}

/**
 * `GET /api/articles/:id/similar?scope`: the stories most like this one, best
 * first, as one page with no next. With `scope=followed` (the default) up to
 * ten from the sources the person follows (NewsBlur's more-like-this); with
 * `scope=all` up to five from any source (NewsBlur's discover), each saying
 * whether the person follows its source. 400 for a bad scope, 404 when there
 * is no such article among the sources the person follows, 401 when not
 * signed in.
 */
export function createSimilarArticles(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<SimilarScope, readonly unknown[] | undefined>({
    method: 'GET',
    decode: similarScope,
    handle: async (scope, { request, uid }) => {
      const id = articleIdOf(request);
      if (id === undefined) return undefined;
      const repo = new Repository(getDatabase());
      const article = await repo.getArticle(uid, id);
      if (!article) return undefined;
      if (scope === 'all') {
        const discovered =
          (await repo.discoverArticles(uid, article.id, MAX_DISCOVERED)) ?? [];
        return discovered.map((item) => discoveredArticleResource(item));
      }
      const similar = await repo.similarArticles(uid, article, SIMILAR);
      return similar.map((item) => articleResource(item));
    },
    encode: (items) =>
      items
        ? page(items, undefined, { 'Cache-Control': 'private, no-cache' })
        : problems.notFound('article'),
  });
}

/** How many stories `/similar?scope=all` lists. */
const MAX_DISCOVERED = 5;

/** The similar-articles controller bound to the production resolver. */
export const similarArticles = createSimilarArticles();

/**
 * `POST /api/articles/:id/extractions`: fetch the article's page again now and
 * keep its text afresh (NewsBlur's forced original text). An extraction is not
 * stored apart from the article, so the answer is the article, 200. 404 when
 * there is no such article among the sources the person follows, 401/403 when
 * not signed in or cross-site.
 */
export function createArticleExtractions(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, Article | undefined>({
    method: 'POST',
    handle: async (_input, { request, uid }) => {
      const id = articleIdOf(request);
      if (id === undefined) return undefined;
      const db = getDatabase();
      const article = await new Repository(db).getArticle(uid, id);
      return article && withText(db, article, true);
    },
    encode: (article) =>
      article
        ? ok(articleDetailResource(article), {
            headers: { 'Cache-Control': 'no-store' },
          })
        : problems.notFound('article'),
  });
}

/** The extractions controller bound to the production resolver. */
export const articleExtractions = createArticleExtractions();
