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
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether the story's text changed since it was first seen. */
export function hasChanges(
  original: string | null | undefined,
  current: string | null | undefined,
): boolean {
  return original != null && plainText(original) !== plainText(current ?? '');
}

/** Append a run, joining it to the last one when they do the same. */
function push(out: Change[], op: Change['op'], word: string): void {
  const last = out.at(-1);
  if (last?.op === op) {
    out[out.length - 1] = { op, text: `${last.text} ${word}` };
  } else {
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
      ...(a.length ? [{ op: 'del' as const, text: a.join(' ') }] : []),
      ...(b.length ? [{ op: 'ins' as const, text: b.join(' ') }] : []),
    ];
  }
  // lengths[i][j]: the longest common run of words of a[i..] and b[j..].
  const lengths = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] =
        a[i] === b[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const out: Change[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(out, 'same', a[i]!);
      i++;
      j++;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      push(out, 'del', a[i++]!);
    } else {
      push(out, 'ins', b[j++]!);
    }
  }
  while (i < a.length) push(out, 'del', a[i++]!);
  while (j < b.length) push(out, 'ins', b[j++]!);
  return out;
}
