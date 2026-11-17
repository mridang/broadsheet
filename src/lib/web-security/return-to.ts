/**
 * @packageDocumentation
 *
 * Where to send a user after they sign in. The value comes from a query
 * string, so it must be a path on this site and nothing else, or the login
 * page becomes an open redirect.
 */

/**
 * The path if it is a safe same-site path (starts with a single `/`, no
 * backslashes or control characters), otherwise undefined.
 */
export function safeReturnPath(value?: string | null): string | undefined {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return undefined;
  }
  // Backslashes are treated as slashes by browsers (`/\evil.example`), and
  // control characters can smuggle in line breaks.
  return Array.from(
    { length: value.length },
    (_, index) => value.codePointAt(index) ?? 0,
  ).some((code) => code === 0x5c || code < 0x20)
    ? undefined
    : value;
}
