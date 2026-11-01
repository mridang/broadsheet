/**
 * @packageDocumentation
 *
 * The daily budgets of Ask AI and the archive assistant, after NewsBlur's
 * usage limits: a person may ask each so many questions a UTC day
 * ({@link DAILY_LIMITS}); answers served from the cache do not count.
 * `GET /api/users/self/usage` says how much of each is left. The per-minute
 * flood limit is the platform's (`RL_AI`); this is the business quota.
 */

import { DAILY_LIMITS, usageDay } from '@/domain/assistant';
import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { ApiController, ok, problems } from '@/lib/core/api';
import { getDatabase } from '@/domain/db/database';
import { Repository, type UsageKind } from '@/domain/repository';

/** How much of one budget is used today. */
export interface BudgetResource {
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  /** When the budget is full again (RFC 3339). */
  readonly resets_at: string;
}

/** The person's budgets for today. */
export interface UsageResource {
  readonly answers: BudgetResource;
  readonly assistant: BudgetResource;
  /** The stories AI prompt classifiers may judge today. */
  readonly classifiers: BudgetResource;
  readonly transcriptions: BudgetResource;
}

/** How much of the `kind` budget the person has used today. */
export async function budget(
  repo: Repository,
  uid: number,
  kind: UsageKind,
  now: Date = new Date(),
): Promise<BudgetResource> {
  const day = usageDay(now);
  const used = await repo.usageSince(uid, kind, day.since);
  const limit = DAILY_LIMITS[kind];
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resets_at: new Date(now.getTime() + day.retryAfter * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z'),
  };
}

/**
 * The 429 to send when the person has used up today's `kind` budget, or
 * undefined when they may ask. `Retry-After` is the time to the next UTC day.
 */
export async function overBudget(
  repo: Repository,
  uid: number,
  kind: UsageKind,
  now: Date = new Date(),
): Promise<Response | undefined> {
  const { remaining, limit } = await budget(repo, uid, kind, now);
  if (remaining > 0) return undefined;
  const what = {
    answer: 'Ask AI questions',
    assistant: 'assistant questions',
    classifier: 'AI classifier checks',
    transcription: 'spoken questions',
  }[kind];
  return problems.rateLimited(
    `You have used all ${limit} ${what} for today. They reset at midnight UTC.`,
    usageDay(now).retryAfter,
  );
}

/** `GET /api/users/self/usage`: today's Ask AI, assistant, AI classifier and spoken-question budgets. 401 when not signed in. */
export function createUsageItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<{ readonly uid: number }> {
  return new ApiController<{ readonly uid: number }>({
    context: async (request) => ({ uid: await liveUid(request, resolver) }),
  }).on<null, UsageResource>({
    method: 'GET',
    handle: async (_input, { uid }) => {
      const repo = new Repository(getDatabase());
      return {
        answers: await budget(repo, uid, 'answer'),
        assistant: await budget(repo, uid, 'assistant'),
        classifiers: await budget(repo, uid, 'classifier'),
        transcriptions: await budget(repo, uid, 'transcription'),
      };
    },
    encode: (body) => ok(body, { headers: { 'Cache-Control': 'no-store' } }),
  });
}

/** The usage controller bound to the production resolver. */
export const usageItem = createUsageItem();
