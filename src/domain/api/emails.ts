/**
 * @packageDocumentation
 *
 * Emailing a story to someone, through Cloudflare Email Sending. Until the
 * sending domain is onboarded and the `EMAIL` binding is in `wrangler.jsonc`,
 * the endpoint answers 503 and the app offers a `mailto:` link instead.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseFeedId } from '@/domain/api/feed-resource';
import {
  parseEmailInput,
  type EmailInput,
} from '@/domain/api/outbound-resource';
import { getDatabase } from '@/domain/db/database';
import { Repository, type Article } from '@/domain/repository';
import { BRAND_NAME } from '@/app/_brand';
import {
  ApiController,
  problem,
  problems,
  readJsonObject,
  type ApiResponse,
} from '@/lib/core/api';
import { getEnv } from '@/lib/core/runtime';
import { errorMessage, logError } from '@/utils/logging';

/** The binding and sender address an email needs. */
export type EmailEnvironment = Partial<
  Pick<CloudflareEnv, 'EMAIL' | 'EMAIL_FROM'>
>;

/** The signed-in caller and the request. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** The article id in `/api/articles/:id/emails`. */
function articleIdOf(request: Request): number | undefined {
  const segments = new URL(request.url).pathname.split('/');
  return parseFeedId(segments[segments.length - 2] ?? '');
}

/** The plain-text email for one story. */
export function storyEmail(
  article: Pick<Article, 'title' | 'url' | 'summary' | 'source'>,
): {
  readonly subject: string;
  readonly text: string;
} {
  const title = article.title || article.url;
  return {
    subject: title,
    text: [
      title,
      article.source ? `From ${article.source}` : '',
      article.summary ?? '',
      article.url,
      '',
      `Sent from ${BRAND_NAME}.`,
    ]
      .filter((line, i, all) => line || (i > 0 && all[i - 1]))
      .join('\n\n'),
  };
}

/**
 * A `mailto:` address that opens the reader's own mail app with the story
 * filled in: the way to share it while Email Sending is not set up.
 */
export function mailtoLink(
  article: Pick<Article, 'title' | 'url' | 'summary' | 'source'>,
): string {
  const { subject, text } = storyEmail(article);
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

/** What the endpoint came to. */
type Outcome = 'sent' | 'missing' | 'unavailable' | 'failed';

/**
 * `POST /api/articles/:id/emails` {to}: email the story to one address. 202
 * once it is handed to the mail service; 400/415 for a bad body, 404 when
 * there is no such article in the person's feeds, 502 when the mail service
 * refused, 503 when email is not set up, 401/403 when not signed in or
 * cross-site.
 */
export function createArticleEmails(
  resolver: CurrentUserResolver = requestCookieResolver,
  environment: () => EmailEnvironment = getEnv,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<EmailInput, Outcome>({
    method: 'POST',
    decode: async (request) => {
      const body = await readJsonObject(
        request,
        'The email must be a JSON object.',
      );
      if (!body.ok) throw body.response;
      const input = parseEmailInput(body.value);
      if (!input.ok)
        throw problems.badRequest('The email is not valid.', input.errors);
      return input.value;
    },
    handle: async ({ to }, { request, uid }) => {
      const id = articleIdOf(request);
      const article =
        id !== undefined
          ? await new Repository(getDatabase()).getArticle(uid, id)
          : undefined;
      if (!article) return 'missing';
      const { EMAIL: mail, EMAIL_FROM: from } = environment();
      if (!mail || !from) return 'unavailable';
      try {
        await mail.send({
          from: { email: from, name: BRAND_NAME },
          to,
          ...storyEmail(article),
        });
        return 'sent';
      } catch (error) {
        logError({ event: 'email.failed', error: errorMessage(error) });
        return 'failed';
      }
    },
    encode: (outcome): ApiResponse<unknown> | Response => {
      switch (outcome) {
        case 'sent':
          return { status: 202, body: { status: 'accepted' } };
        case 'missing':
          return problems.notFound('article');
        case 'unavailable':
          return problem(
            503,
            '/problems/unavailable',
            'Service unavailable',
            'Email is not set up on this server.',
            {
              headers: { 'Retry-After': '86400' },
            },
          );
        case 'failed':
          return problem(
            502,
            '/problems/upstream',
            'Bad gateway',
            'The mail service did not take the email.',
          );
      }
    },
  });
}

/** The article-email controller bound to the production resolver. */
export const articleEmails = createArticleEmails();
