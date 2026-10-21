/**
 * @packageDocumentation
 *
 * Turning an API error response (RFC 9457 problem details) into a sentence for
 * the user: the problem's `detail` if it has one, otherwise its `title`, plus any
 * per-field messages. Safe to call on any response; falls back to the status.
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

/**
 * What to show for a caught error: the API's own words if it refused, otherwise
 * `fallback` (a network failure's "Failed to fetch" helps nobody).
 */
export function problemText(error: unknown, fallback: string): string {
  return error instanceof ProblemError ? error.message : fallback;
}
