/**
 * @packageDocumentation
 *
 * Emailing a story to other people through Cloudflare Email Sending, as
 * NewsBlur's "send story by email" does: to several addresses, with the
 * sender's own note, a copy to the sender, replies going to the sender, and a
 * daily quota. Until the sending domain is onboarded and the `EMAIL` binding
 * is in `wrangler.jsonc`, the endpoint answers 503 and the app offers a
 * `mailto:` link instead.
 */

import {
  requestCookieResolver,
  sessionUser,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseFeedId } from '@/domain/api/feed-resource';
import {
  parseEmailInput,
  type EmailInput,
} from '@/domain/api/outbound-resource';
import { escapeXml } from '@/domain/atom';
import { getDatabase } from '@/domain/db/database';
import { NotificationRepository } from '@/domain/notifications';
import { Repository, type Article, type User } from '@/domain/repository';
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

/** How many stories one person may email to others in a day. */
export const DAILY_STORY_EMAILS = 32;

/** The most of a story's text an email carries. */
const MAX_BODY = 20_000;

/** The signed-in caller and the request. */
interface UserContext {
  readonly request: Request;
  readonly user: User;
}

/** The article id in `/api/articles/:id/emails`. */
function articleIdOf(request: Request): number | undefined {
  const segments = new URL(request.url).pathname.split('/');
  return parseFeedId(segments[segments.length - 2] ?? '');
}

/** The parts of a story an email shows. */
export type EmailedStory = Pick<
  Article,
  'title' | 'url' | 'summary' | 'source'
> &
  Partial<Pick<Article, 'body_text'>>;

/** Who is sending, and what they add. */
export interface StoryEmailOptions {
  readonly sender?: string;
  readonly comment?: string | undefined;
}

/**
 * The email for one story, as plain text and HTML: the sender's note, the
 * headline, where it is from, its summary and kept text, and the link.
 */
export function storyEmail(
  article: EmailedStory,
  options: StoryEmailOptions = {},
): {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
} {
  const title = article.title || article.url;
  const body = (article.body_text ?? '').slice(0, MAX_BODY);
  const paragraphs = [
    options.comment && options.sender
      ? `${options.sender} wrote: ${options.comment}`
      : (options.comment ?? ''),
    title,
    article.source ? `From ${article.source}` : '',
    article.summary ?? '',
    ...body.split('\n\n'),
    article.url,
    options.sender
      ? `Sent by ${options.sender} from ${BRAND_NAME}.`
      : `Sent from ${BRAND_NAME}.`,
  ].filter((line) => line.trim());
  const html = [
    '<!doctype html><html><body>',
    ...paragraphs.map((p) =>
      p === article.url
        ? `<p><a href="${escapeXml(p)}">${escapeXml(p)}</a></p>`
        : p === title
          ? `<h1>${escapeXml(p)}</h1>`
          : `<p>${escapeXml(p)}</p>`,
    ),
    '</body></html>',
  ].join('\n');
  return {
    subject: title.replace(/\s+/g, ' '),
    text: paragraphs.join('\n\n'),
    html,
  };
}

/**
 * A `mailto:` address that opens the reader's own mail app with the story
 * filled in: the way to share it while Email Sending is not set up.
 */
export function mailtoLink(article: EmailedStory): string {
  // The kept text would make the address too long for a mail app.
  const { subject, text } = storyEmail({ ...article, body_text: null });
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

/** What the endpoint came to. */
type Outcome = 'sent' | 'missing' | 'quota' | 'unavailable' | 'failed';

/**
 * `POST /api/articles/:id/emails` {to, comment?, copy_me?}: email the story
 * to up to ten addresses, with the sender's note, a copy to the sender unless
 * `copy_me` is false, and replies going to the sender. 202 once the mail
 * service took it; 400/415 for a bad body, 404 when there is no such article
 * in the person's feeds, 429 once they have emailed 32 stories in a day, 502
 * when the mail service refused, 503 when email is not set up, 401/403 when
 * not signed in or cross-site.
 */
export function createArticleEmails(
  resolver: CurrentUserResolver = requestCookieResolver,
  environment: () => EmailEnvironment = getEnv,
): ApiController<UserContext> {
  return new ApiController<UserContext>({
    context: async (request) => ({
      request,
      user: await sessionUser(request, resolver),
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
    handle: async (input, { request, user }) => {
      const db = getDatabase();
      const id = articleIdOf(request);
      const article =
        id !== undefined
          ? await new Repository(db).getArticle(user.id, id)
          : undefined;
      if (!article) return 'missing';
      const { EMAIL: mail, EMAIL_FROM: from } = environment();
      if (!mail || !from) return 'unavailable';
      const counts = new NotificationRepository(db);
      if ((await counts.storyEmailsToday(user.id)) >= DAILY_STORY_EMAILS) {
        return 'quota';
      }
      const sender = input.from_name || user.name || user.email;
      try {
        await mail.send({
          from: { email: from, name: `${sender} via ${BRAND_NAME}` },
          to: [...input.to],
          ...(input.copy_me ? { cc: user.email } : {}),
          replyTo: { email: user.email, name: sender },
          ...storyEmail(article, { sender, comment: input.comment }),
        });
      } catch (error) {
        logError({ event: 'email.failed', error: errorMessage(error) });
        return 'failed';
      }
      await counts.recordStoryEmail(user.id, article.id, input.to.length);
      return 'sent';
    },
    encode: (outcome): ApiResponse<unknown> | Response => {
      switch (outcome) {
        case 'sent':
          return { status: 202, body: { status: 'accepted' } };
        case 'missing':
          return problems.notFound('article');
        case 'quota':
          return problems.rateLimited(
            `You can email ${DAILY_STORY_EMAILS} stories a day.`,
            86400,
          );
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
