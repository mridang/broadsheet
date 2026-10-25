/**
 * @packageDocumentation
 *
 * Entity tags for optimistic concurrency and cheap re-reads. A tag is a hash of
 * a resource's content, so it changes exactly when the content does.
 * `If-Match` on a write refuses (412) if the resource changed meanwhile;
 * `If-None-Match` on a read answers 304 when nothing changed. This is the
 * generic HTTP machinery only — how a given resource derives its tag (and any
 * per-representation variants) belongs to that resource's domain.
 */

/** A strong entity tag for some text: the quoted first 16 hex digits of its SHA-256. */
export async function entityTag(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  const hex = [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `"${hex}"`;
}

/** The tags in an `If-Match` / `If-None-Match` header (weak markers ignored). */
function tagsIn(header: string): readonly string[] {
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .filter(Boolean);
}

/** Whether an `If-Match` header allows a write against `current`. Absent means yes. */
export function ifMatchSatisfied(
  header: string | null,
  current: string,
): boolean {
  if (header === null) {
    return true;
  }
  const tags = tagsIn(header);
  return tags.includes('*') || tags.includes(current);
}

/** Whether an `If-None-Match` header says the client already has `current`. */
export function ifNoneMatchHit(
  header: string | null,
  current: string,
): boolean {
  if (header === null) {
    return false;
  }
  const tags = tagsIn(header);
  return tags.includes('*') || tags.includes(current);
}
