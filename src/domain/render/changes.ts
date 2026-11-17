/**
 * @packageDocumentation
 *
 * What changed in a story: NewsBlur's htmldiff of the text a story first had
 * against the text it has now. The texts are compared word by word, with
 * their markup taken out, and the result is a list of runs kept, added or
 * taken out, which the page shows as `<ins>` and `<del>` without ever
 * inserting HTML.
 */

/** A run of the diff: text both versions have, or only the new or old one. */
export interface Change {
  readonly op: 'same' | 'ins' | 'del';
  readonly text: string;
}

/** Most words compared; past it the whole text is shown replaced. */
export const MAX_WORDS = 3000;

/** A story's text without its markup, its entities read and its spaces folded. */
export function plainText(html: string): string {
  const bare = stripTags(
    html
      .replaceAll(/<(script|style)[^>]*>[\s\S]*?<\/\1>/giu, ' ')
      .replaceAll(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/giu, ' '),
  );
  return bare
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll(/&#39;|&apos;/gu, "'")
    .replaceAll('&amp;', '&')
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

/** Removes every `<...>` run; same result as `replaceAll(/<[^>]*>/g, '')`, in linear time. */
function stripTags(html: string): string {
  // eslint-disable-next-line functional/no-let -- the diff is a dynamic-programming table filled and walked by index, over up to 3000 words a side
  let out = '';
  // eslint-disable-next-line functional/no-let -- the diff is a dynamic-programming table filled and walked by index, over up to 3000 words a side
  let from = 0;
  // eslint-disable-next-line functional/no-let -- the diff is a dynamic-programming table filled and walked by index, over up to 3000 words a side
  let open = html.indexOf('<');
  // eslint-disable-next-line functional/no-loop-statements -- the diff is a dynamic-programming table filled and walked by index, over up to 3000 words a side
  while (open !== -1) {
    const close = html.indexOf('>', open + 1);
    if (close === -1) {
      break;
    }
    out += html.slice(from, open);
    from = close + 1;
    open = html.indexOf('<', from);
  }
  return out + html.slice(from);
}

/** Whether the story's text changed since it was first seen. */
export function hasChanges(
  original: string | null | undefined,
  current: string | null | undefined,
): boolean {
  return (
    original !== null &&
    original !== undefined &&
    plainText(original) !== plainText(current ?? '')
  );
}

/** Append a run, joining it to the last one when they do the same. */
function push(out: Change[], op: Change['op'], word: string): void {
  const last = out.at(-1);
  if (last?.op === op) {
    // eslint-disable-next-line functional/immutable-data -- the table cells and the list of runs are built in place so the diff stays linear in memory
    out[out.length - 1] = { op, text: `${last.text} ${word}` };
  } else {
    // eslint-disable-next-line functional/immutable-data -- the table cells and the list of runs are built in place so the diff stays linear in memory
    out.push({ op, text: word });
  }
}

/**
 * The runs that turn `original` into `current`: the longest run of words
 * they share kept, the rest taken out of the old or added in the new. Runs
 * are joined by single spaces.
 */
export function storyChanges(original: string, current: string): Change[] {
  const a = plainText(original).split(' ').filter(Boolean);
  const b = plainText(current).split(' ').filter(Boolean);
  if (a.length > MAX_WORDS || b.length > MAX_WORDS) {
    return [
      ...(a.length > 0 ? [{ op: 'del' as const, text: a.join(' ') }] : []),
      ...(b.length > 0 ? [{ op: 'ins' as const, text: b.join(' ') }] : []),
    ];
  }
  // lengths[i][j]: the longest common run of words of a[i..] and b[j..].
  const lengths = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  // eslint-disable-next-line functional/no-let, functional/no-loop-statements -- the diff is a dynamic-programming table filled and walked by index, over up to 3000 words a side
  for (let index = a.length - 1; index >= 0; index--) {
    // eslint-disable-next-line functional/no-let, functional/no-loop-statements -- the diff is a dynamic-programming table filled and walked by index, over up to 3000 words a side
    for (let index3 = b.length - 1; index3 >= 0; index3--) {
      // eslint-disable-next-line functional/immutable-data -- the table cells and the list of runs are built in place so the diff stays linear in memory
      lengths[index]![index3] =
        a[index] === b[index3]
          ? lengths[index + 1]![index3 + 1]! + 1
          : Math.max(
              lengths[index + 1]![index3]!,
              lengths[index]![index3 + 1]!,
            );
    }
  }
  const out: Change[] = [];
  // eslint-disable-next-line functional/no-let -- the diff is a dynamic-programming table filled and walked by index, over up to 3000 words a side
  let index = 0;
  // eslint-disable-next-line functional/no-let -- the diff is a dynamic-programming table filled and walked by index, over up to 3000 words a side
  let index2 = 0;
  // eslint-disable-next-line functional/no-loop-statements -- the diff is a dynamic-programming table filled and walked by index, over up to 3000 words a side
  while (index < a.length && index2 < b.length) {
    if (a[index] === b[index2]) {
      push(out, 'same', a[index]!);
      index++;
      index2++;
    } else if (lengths[index + 1]![index2]! >= lengths[index]![index2 + 1]!) {
      push(out, 'del', a[index]!);
      index++;
    } else {
      push(out, 'ins', b[index2]!);
      index2++;
    }
  }
  // eslint-disable-next-line functional/no-loop-statements -- the diff is a dynamic-programming table filled and walked by index, over up to 3000 words a side
  while (index < a.length) {
    push(out, 'del', a[index]!);
    index++;
  }
  // eslint-disable-next-line functional/no-loop-statements -- the diff is a dynamic-programming table filled and walked by index, over up to 3000 words a side
  while (index2 < b.length) {
    push(out, 'ins', b[index2]!);
    index2++;
  }
  return out;
}
