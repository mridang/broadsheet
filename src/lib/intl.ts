/**
 * @packageDocumentation
 *
 * Locale-aware text helpers built on the standard `Intl` APIs, so ordering,
 * counts, dates and lists are right for real-world text ("Éclair" sorts with E,
 * "1 recipe" vs "2 recipes", "3 days ago") instead of relying on code-unit
 * comparisons and hand-rolled plural checks.
 *
 * Everything here uses one fixed locale, English. The interface text around
 * these values is English, so mixing in the visitor's locale would produce
 * half-translated sentences, and a fixed locale keeps server and browser output
 * identical (no hydration mismatches, stable API messages). Changing
 * {@link LOCALE} is the single switch if the app is ever translated.
 */

/** The locale used for all formatting. */
export const LOCALE = 'en';

const collator = new Intl.Collator(LOCALE, {
  // "Apple" = "apple" = "Äpple" for ordering purposes; ties fall to the caller.
  sensitivity: 'base',
  // "Recipe 2" before "Recipe 10".
  numeric: true,
});

/**
 * Compare two strings the way a person would alphabetise them: accents and case
 * are ignored, and runs of digits compare as numbers. Returns 0 for strings
 * that differ only by accent or case, so callers should break ties themselves.
 */
export function compareText(a: string, b: string): number {
  return collator.compare(a, b);
}

/**
 * Fold text for searching: lower case with accents removed, so "creme" finds
 * "Crème brûlée". (`Intl` can compare whole strings but has no substring
 * search, so matching uses this folded form with `includes`.)
 */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

const plurals = new Intl.PluralRules(LOCALE);
const counts = new Intl.NumberFormat(LOCALE);

/**
 * A count with its noun in the right plural form: `countOf(1, 'recipe')` is
 * "1 recipe", `countOf(2, 'recipe')` is "2 recipes". Pass `many` for nouns that
 * don't just add an "s".
 */
export function countOf(n: number, one: string, many = `${one}s`): string {
  return `${counts.format(n)} ${plurals.select(n) === 'one' ? one : many}`;
}

/** A formatter that keeps at most `maxFractionDigits` decimal places. */
const decimalFormat = (maxFractionDigits: number): Intl.NumberFormat =>
  new Intl.NumberFormat(LOCALE, {
    maximumFractionDigits: maxFractionDigits,
    useGrouping: false,
  });

/** Formatters built once for the precisions in common use (0 to 6 places). */
const COMMON_DECIMALS = Array.from({ length: 7 }, (_, places) =>
  decimalFormat(places),
);

/**
 * A plain decimal for a quantity: at most `maxFractionDigits` places, no
 * trailing zeros and no thousands separators ("0.5", "250", "1.25").
 */
export function formatQuantityNumber(
  value: number,
  maxFractionDigits = 2,
): string {
  const format =
    COMMON_DECIMALS[maxFractionDigits] ?? decimalFormat(maxFractionDigits);
  return format.format(value);
}

/** Says a gap in time in words ("yesterday", "in 2 hours"). */
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/** Seconds in each unit, largest first, for choosing how to say an age. */
const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/**
 * How long ago (or from now) a moment is, in words: "yesterday", "3 days ago",
 * "in 2 hours". Anything within a minute is "now".
 */
export function relativeTime(
  when: Date | string,
  now: Date = new Date(),
): string {
  const seconds = (new Date(when).getTime() - now.getTime()) / 1000;
  const magnitude = Math.abs(seconds);
  for (const [unit, size] of UNITS) {
    if (magnitude >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return relative.format(0, 'second');
}

/** Joins items with "and". */
const andList = new Intl.ListFormat(LOCALE, {
  style: 'long',
  type: 'conjunction',
});
/** Joins items with "or". */
const orList = new Intl.ListFormat(LOCALE, {
  style: 'long',
  type: 'disjunction',
});

/** "a, b and c". */
export function listAnd(items: readonly string[]): string {
  return andList.format(items);
}

/** "a, b or c". */
export function listOr(items: readonly string[]): string {
  return orList.format(items);
}

/** A rating or score, always with one decimal place: "8.0", "7.4". */
const ratings = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** A size in gigabytes, one decimal place at most: "1.5 GB". */
const gigabytes = new Intl.NumberFormat(LOCALE, {
  style: 'unit',
  unit: 'gigabyte',
  unitDisplay: 'short',
  maximumFractionDigits: 1,
});

/** A size in whole megabytes: "640 MB". */
const megabytes = new Intl.NumberFormat(LOCALE, {
  style: 'unit',
  unit: 'megabyte',
  unitDisplay: 'short',
  maximumFractionDigits: 0,
});

/** A share of a whole (0.25) as a percentage with no decimals. */
const percents = new Intl.NumberFormat(LOCALE, {
  style: 'percent',
  maximumFractionDigits: 0,
});

/** A rating or score with exactly one decimal place: "8.0". */
export function formatRating(value: number): string {
  return ratings.format(value);
}

/** A size in gigabytes, to one decimal place at most: "1.5 GB". */
export function formatGigabytes(gigabyteCount: number): string {
  return gigabytes.format(gigabyteCount);
}

/** A file size in bytes, in gigabytes from 1 GB up and megabytes below: "640 MB". */
export function formatSize(bytes: number): string {
  return bytes >= 1_000_000_000
    ? gigabytes.format(bytes / 1_000_000_000)
    : megabytes.format(bytes / 1_000_000);
}

/** A fraction as a whole-number percentage: `formatPercent(0.256)` is "26%". */
export function formatPercent(fraction: number): string {
  return percents.format(fraction);
}

/** Writes an hour of the day (0 to 23) as a clock time: "07:00". */
const hours = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

/** An hour of the day (0 to 23) as a 24-hour clock time: `formatHour(7)` is "07:00". */
export function formatHour(hour: number): string {
  return hours.format(Date.UTC(1970, 0, 1, hour));
}
