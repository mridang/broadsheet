/**
 * @packageDocumentation
 *
 * Browser-side reading of the API's error responses. The server emits RFC 9457
 * problem details (see `@/lib/core/api/problem`); this turns one back into a
 * sentence to show the person, and `ensureOk` throws it for a failed fetch so a
 * caller can `try`/`catch` one way for every request. This is client code — it
 * lives with the components, not in the server `lib/core/api` package.
 */

import { z } from 'zod';

/** The parts of an API problem body the person is shown; anything else is ignored. */
const PROBLEM_BODY = z.object({
  detail: z
    .string()
    .optional()
    .catch(() => undefined),
  title: z
    .string()
    .optional()
    .catch(() => undefined),
  errors: z.array(z.unknown()).catch(() => []),
});

/** The readable message from a failed API response. */
export async function problemMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    const problem = PROBLEM_BODY.safeParse(body).data;
    const main =
      problem?.detail ?? problem?.title ?? `Request failed (${res.status}).`;
    const errors = (problem?.errors ?? []).filter(
      (item): item is string => typeof item === 'string',
    );
    return errors.length > 0 ? `${main} ${errors.join(' ')}` : main;
  } catch {
    return `Request failed (${res.status}).`;
  }
}

/** An API refusal, carrying the sentence to show the user. */
export class ProblemError extends Error {
  override readonly name = 'ProblemError';
}

/** The error to throw for a failed API response, to be shown with {@link problemText}. */
export async function problemError(res: Response): Promise<ProblemError> {
  return new ProblemError(await problemMessage(res));
}

/** Throw the server's refusal when `res` is not ok; otherwise do nothing. */
export async function ensureOk(res: Response): Promise<void> {
  if (!res.ok) {
    throw await problemError(res);
  }
}

/**
 * What to show for a caught error: the API's own words if it refused, otherwise
 * `fallback` (a network failure's "Failed to fetch" helps nobody).
 */
export function problemText(error: unknown, fallback: string): string {
  return error instanceof ProblemError ? error.message : fallback;
}
