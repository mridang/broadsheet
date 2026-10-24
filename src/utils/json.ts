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
 *
 * @returns `{ ok: true, value }` on success, `{ ok: false, error }` with
 *   the parser's message otherwise.
 * @public
 */
export function safeJsonParse<T>(text: string): JsonParseResult<T> {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
