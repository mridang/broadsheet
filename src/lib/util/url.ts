/**
 * @packageDocumentation
 *
 * Parsing URLs that arrive from outside (query strings, client metadata,
 * redirect addresses), where a malformed one is a normal answer, not a crash.
 */

/** The URL in `text` (resolved against `base` when given), or undefined when it isn't one. */
export function parseUrl(text: string, base?: string): URL | undefined {
  try {
    return new URL(text, base);
  } catch {
    return undefined;
  }
}
