/**
 * @packageDocumentation
 *
 * The primitives for cursor-paginated list endpoints. The cursor is an opaque
 * url-safe token a client passes back unchanged; inside it is the sort key and
 * id of the last item on the previous page, so the next page starts right after
 * it even if items were added or removed meanwhile.
 *
 * These are the pure pieces a handler uses to compute a page: validate the
 * `limit`, decode an incoming cursor, and slice the next page off a sorted
 * list. The controller turns the resulting {@link Slice} into the wire body
 * (`{ self, next, items }`) and its links — see the `page` result in
 * `./results` — so the URL building lives in one place, not here.
 */

import { problems } from './problem';

/** The default page size when the client asks for none. */
export const DEFAULT_LIMIT = 20;

/** The largest page a client may ask for. */
export const MAX_LIMIT = 100;

/** Where a page starts after: the sort key and id of the previous page's last item. */
export interface CursorPosition {
  readonly key: string;
  readonly id: string;
}

/** Encode a position as an opaque url-safe token. */
export function encodeCursor(position: CursorPosition): string {
  const json = JSON.stringify([position.key, position.id]);
  const bytes = new TextEncoder().encode(json);
  return bytesToBase64Url(bytes);
}

/** Decode a cursor, or `undefined` if it is not one we issued. */
export function decodeCursor(cursor: string): CursorPosition | undefined {
  try {
    const bytes = base64UrlToBytes(cursor);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
    ) {
      return { key: parsed[0], id: parsed[1] };
    }
  } catch {
    // Not a token we issued; treated as no cursor.
  }
  return undefined;
}

/** The validated `limit` query parameter, or the 400 to send for a bad one. */
export function parseLimit(
  raw: string | null,
  fallback: number = DEFAULT_LIMIT,
): number | Response {
  if (raw === null) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    return problems.badRequest(
      `limit must be a whole number from 1 to ${MAX_LIMIT}.`,
    );
  }
  return n;
}

/** One page of already-sorted items, with the position of the last when more follow. */
export interface Slice<T> {
  readonly items: readonly T[];
  /** Position of the last item, when more follow. */
  readonly next?: CursorPosition;
}

/**
 * Take the page that follows `after` from a sorted list. `positionOf` reads an
 * item's cursor position; `compare` orders two positions the same way the list
 * is sorted.
 */
export function sliceAfter<T>(
  sorted: readonly T[],
  positionOf: (item: T) => CursorPosition,
  compare: (a: CursorPosition, b: CursorPosition) => number,
  after: CursorPosition | undefined,
  limit: number,
): Slice<T> {
  const rest = after
    ? sorted.filter((item) => compare(positionOf(item), after) > 0)
    : sorted;
  const items = rest.slice(0, limit);
  const last = items.at(-1);
  return rest.length > limit && last
    ? { items, next: positionOf(last) }
    : { items };
}

/** Base64url-encode bytes (RFC 4648 §5: `+/` → `-_`, no padding). */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decode base64url bytes, the inverse of {@link bytesToBase64Url}. */
function base64UrlToBytes(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
