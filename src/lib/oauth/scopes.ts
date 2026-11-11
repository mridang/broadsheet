/**
 * @packageDocumentation
 *
 * The scopes a client can ask for. `read` lets an assistant look at the
 * person's feeds, paper and archive; `write` also lets it change them (follow,
 * save, train), and implies `read`.
 */

/** Look, never change. */
export const SCOPE_READ = 'read';
/** Change as well as look. */
export const SCOPE_WRITE = 'write';
/** Asked for by clients that want a refresh token; every grant gets one anyway. */
export const SCOPE_OFFLINE_ACCESS = 'offline_access';

/** Every scope a grant can carry. */
export const SUPPORTED_SCOPES: readonly string[] = [SCOPE_READ, SCOPE_WRITE];

/**
 * The supported scopes named in a space-separated `scope` parameter, in our
 * order. Asking for none (or only for scopes we do not know) means all of them,
 * as the client has no way to know our names before discovery.
 */
export function normaliseScope(
  requested: string | null | undefined,
): readonly string[] {
  const asked = new Set((requested ?? '').split(/\s+/).filter(Boolean));
  const known = SUPPORTED_SCOPES.filter((s) => asked.has(s));
  return known.length > 0 ? known : SUPPORTED_SCOPES;
}

/** Whether `granted` allows what `needed` asks for (`write` implies `read`). */
export function hasScope(granted: readonly string[], needed: string): boolean {
  return (
    granted.includes(needed) ||
    (needed === SCOPE_READ && granted.includes(SCOPE_WRITE))
  );
}
