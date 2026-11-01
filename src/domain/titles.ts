/**
 * @packageDocumentation
 *
 * Comparing headlines, as NewsBlur does to find the same story in two feeds:
 * a title is normalised (lowercase, no punctuation) and reduced to its
 * significant words (no stopwords, numbers, one-letter words, or words of the
 * feed's own name), lightly stemmed. Two titles match when they normalise the
 * same, or when enough of the shorter title's words appear in the other.
 */

/** Shortest normalised title compared for an exact match. */
export const MIN_TITLE_LENGTH = 10;
/** Fewest significant words a title needs for a fuzzy match. */
export const FUZZY_MIN_WORDS = 5;
/** Fewest shared words, and least overlap, for a fuzzy title match. */
export const FUZZY_MIN_SHARED = 3;
export const FUZZY_MIN_OVERLAP = 0.6;
/** Fewest shared words, and least overlap, that confirm an embedding match. */
export const RELATED_MIN_SHARED = 4;
export const RELATED_MIN_OVERLAP = 0.45;

const STOPWORDS = new Set(
  (
    'a about after all also an and any are as at be been but by can could did ' +
    'do does for from had has have he her his how if in into is it its just ' +
    'more most new no not now of on one or our out over says she so than that ' +
    'the their them then there these they this to up us was we were what when ' +
    'which who why will with would you your'
  ).split(' '),
);

/** A title lowercased, hyphens and slashes as spaces, punctuation gone. */
export function normaliseTitle(title: string | null): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/[-/]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A word with a plural "s" taken off ("ss" and short words kept). */
const stem = (word: string): string =>
  word.length > 3 && word.endsWith('s') && !word.endsWith('ss')
    ? word.slice(0, -1)
    : word;

/** The words of a title that say what the story is about. */
export function significantWords(
  title: string | null,
  feedTitle: string | null = null,
): Set<string> {
  const own = new Set(normaliseTitle(feedTitle).split(' ').map(stem));
  return new Set(
    normaliseTitle(title)
      .split(' ')
      .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !STOPWORDS.has(w))
      .map(stem)
      .filter((w) => !own.has(w)),
  );
}

/** Words two sets share, and that count over the smaller set's size. */
export function overlap(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): { readonly shared: number; readonly coefficient: number } {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const smaller = Math.min(a.size, b.size);
  return { shared, coefficient: smaller ? shared / smaller : 0 };
}

/** Whether two titles normalise to the same long-enough text. */
export function sameTitle(a: string | null, b: string | null): boolean {
  const x = normaliseTitle(a);
  return x.length >= MIN_TITLE_LENGTH && x === normaliseTitle(b);
}

/** Whether two word sets are close enough for a fuzzy title match. */
export function fuzzyMatch(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): boolean {
  if (a.size < FUZZY_MIN_WORDS || b.size < FUZZY_MIN_WORDS) return false;
  const { shared, coefficient } = overlap(a, b);
  return shared >= FUZZY_MIN_SHARED && coefficient >= FUZZY_MIN_OVERLAP;
}

/** Whether two word sets share enough to confirm a match the embeddings found. */
export function relatedMatch(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): boolean {
  const { shared, coefficient } = overlap(a, b);
  return shared >= RELATED_MIN_SHARED && coefficient >= RELATED_MIN_OVERLAP;
}

/**
 * How two stories in one cluster relate: 'title' when their titles match
 * exactly or fuzzily, else 'related' (only the embeddings joined them).
 */
export function matchTier(
  a: string | null,
  b: string | null,
): 'title' | 'related' {
  return sameTitle(a, b) || fuzzyMatch(significantWords(a), significantWords(b))
    ? 'title'
    : 'related';
}
