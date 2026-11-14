/**
 * @packageDocumentation
 *
 * Building query strings and addresses with query parameters set, the way
 * `URLSearchParams.set` would.
 */

/** One `name=value` pair of a query string. */
type Entry = readonly [string, string];

/** The entries with `key` set to `value`: replacing the first one in place, dropping repeats, or appending when absent. */
function setEntry(
  entries: readonly Entry[],
  key: string,
  value: string,
): readonly Entry[] {
  const first = entries.findIndex(([name]) => name === key);
  return first === -1
    ? [...entries, [key, value]]
    : entries.flatMap((entry, at): readonly Entry[] => {
        if (entry[0] !== key) {
          return [entry];
        }
        return at === first ? [[key, value]] : [];
      });
}

/**
 * A query string (`?a=1`, or empty when there is nothing) built from `search`
 * with each of `params` set, the way `URLSearchParams.set` would: an existing
 * parameter keeps its place and loses its repeats, a new one goes on the end.
 */
export function setSearchParams(
  search: string,
  params: Readonly<Record<string, string>>,
): string {
  const entries = Object.entries(params).reduce<readonly Entry[]>(
    (current, [key, value]) => setEntry(current, key, value),
    [...new URLSearchParams(search)],
  );
  const text = new URLSearchParams(
    entries.map(([name, value]) => [name, value]),
  ).toString();
  return text ? `?${text}` : '';
}

/**
 * `uri` with the given query parameters set (see {@link setSearchParams}),
 * keeping its path, any other query it already has, and its fragment. Works
 * for app-scheme addresses such as `app://callback` too.
 */
export function withQueryParams(
  uri: string,
  params: Readonly<Record<string, string>>,
): string {
  const url = new URL(uri);
  if (Object.keys(params).length === 0) {
    return url.toString();
  }
  const [, base = '', query = '', hash = ''] =
    /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url.href) ?? [];
  return `${base}${setSearchParams(query, params)}${hash}`;
}
