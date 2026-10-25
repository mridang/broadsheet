/**
 * @packageDocumentation
 *
 * Browser-side reading of the API's error responses. The server emits RFC 9457
 * problem details (see `@/lib/core/api/problem`); this turns one back into a
 * sentence to show the person, and `ensureOk` throws it for a failed fetch so a
 * caller can `try`/`catch` one way for every request. This is client code — it
 * lives with the components, not in the server `lib/core/api` package.
 */

/** The string at `key` in a parsed JSON object, if there is one. */
function stringMember(body: unknown, key: string): string | undefined {
  const value: unknown =
    typeof body === 'object' && body !== null
      ? Reflect.get(body, key)
      : undefined;
  return typeof value === 'string' ? value : undefined;
}

/** The strings in the array at `key` in a parsed JSON object (none if it isn't an array). */
function stringListMember(body: unknown, key: string): readonly string[] {
  const value: unknown =
    typeof body === 'object' && body !== null
      ? Reflect.get(body, key)
      : undefined;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** The readable message from a failed API response. */
export async function problemMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    const main =
      stringMember(body, 'detail') ??
      stringMember(body, 'title') ??
      `Request failed (${res.status}).`;
    const errors = stringListMember(body, 'errors');
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
