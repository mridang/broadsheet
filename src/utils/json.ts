/**
 * @packageDocumentation
 *
 * Throw-free JSON parsing. Upstream responses are untrusted, so callers
 * branch on a discriminated result instead of wrapping every parse in a
 * try/catch (which forces a mutable `let`).
 */

/** Outcome of {@link safeJsonParse}. @public */
export type JsonParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/**
 * Parse `text` as JSON without throwing.
 * @returns `{ ok: true, value }` on success, `{ ok: false, error }` with
 * the parser's message otherwise.
 * @public
 */
export function safeJsonParse<T>(text: string): JsonParseResult<T> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the caller names the shape it expects of the text it chose to parse (`safeJsonParse<T>`), which is the function's public contract and cannot be proven from a string
    return { ok: true, value: JSON.parse(text) as T };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
