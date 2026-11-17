/**
 * @packageDocumentation
 *
 * What the briefing pages show of a briefing: each section's heading, its
 * stories grouped by section in the briefing's order, the summary split into
 * paragraphs, and the line about how it was written.
 */

import { countOf } from '@/lib/intl';
import type { Category } from '@/domain/briefing';

const SECTION_HEADING_PATTERN = /^custom_(\d+)$/u;
const PARAGRAPHS_PATTERN = /\n\s*\n/u;
const WRITTEN_WITH_PATTERN = /^@cf\//u;

/** The heading of each fixed section, as the briefing prints it. */
const HEADINGS = {
  widely_covered: 'Widely covered',
  infrequent: 'From quieter sources',
  follow_up: 'Follow-ups',
  classifier_match: 'Picked for you',
  long_read: 'Long reads',
  top_stories: 'Top stories',
  widely_read: 'Most read',
  long_reads: 'Long reads everyone is reading',
  good_reads: 'Good reads',
  global_shared: 'Most shared',
} as const satisfies Readonly<Record<string, string>>;

/** A section's heading; a custom one is "Your topic" and its number. */
export function sectionHeading(category: Category): string {
  const custom = SECTION_HEADING_PATTERN.exec(category);
  if (custom) {
    return `Your topic ${custom[1]}`;
  }
  return Object.hasOwn(HEADINGS, category)
    ? HEADINGS[category as keyof typeof HEADINGS]
    : category.replaceAll('_', ' ');
}

/**
 * The stories grouped by section: the briefing's own sections first, in its
 * order, then any other section a story names, in the order they appear.
 * Sections with no stories are left out.
 */
export function groupBySection<T extends { readonly category: Category }>(
  stories: readonly T[],
  order: readonly Category[],
): { category: Category; stories: T[] }[] {
  const seen = [...order, ...stories.map((s) => s.category)];
  return Array.from(new Set(seen), (category) => ({
    category,
    stories: stories.filter((s) => s.category === category),
  })).filter((g) => g.stories.length > 0);
}

/** The summary as paragraphs, split on blank lines (or lines, when it has none). */
export function paragraphs(summary: string | null | undefined): string[] {
  const text = (summary ?? '').trim();
  if (!text) {
    return [];
  }
  const blocks = text.split(PARAGRAPHS_PATTERN);
  return (blocks.length > 1 ? blocks : text.split('\n'))
    .map((p) => p.trim())
    .filter(Boolean);
}

/** The small print: which model wrote it, with how many tokens, how fast. */
export function writtenWith({
  model,
  tokens,
  seconds,
}: {
  readonly model?: string | null;
  readonly tokens?: number | null;
  readonly seconds?: number | null;
}): string {
  return [
    model ? `Written by ${model.replace(WRITTEN_WITH_PATTERN, '')}` : null,
    tokens === undefined || tokens === null ? null : countOf(tokens, 'token'),
    seconds === undefined || seconds === null
      ? null
      : `${Math.round(seconds * 10) / 10}s`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The stages writing a briefing goes through, as the progress bar names them. */
export const STAGES = [
  'Gathering stories',
  'Choosing sections',
  'Writing the summary',
  'Saving the briefing',
] as const;

/** How long, in milliseconds, each stage is shown before the next. */
export const STAGE_MS = 2500;

/**
 * The stage shown `elapsed` milliseconds into writing: one every `STAGE_MS`,
 * staying on the last until the answer comes.
 */
export function stageAt(elapsed: number): number {
  return Math.min(
    STAGES.length - 1,
    Math.max(0, Math.floor(elapsed / STAGE_MS)),
  );
}

/**
 * How full the bar is, in percent: each stage fills its share, and the bar
 * never reaches the end before the answer does.
 */
export function progressAt(elapsed: number): number {
  const share = 100 / STAGES.length;
  const within = Math.min(1, (elapsed % STAGE_MS) / STAGE_MS);
  const stage = stageAt(elapsed);
  const done = elapsed >= STAGE_MS * STAGES.length;
  return done ? 95 : Math.min(95, Math.round(stage * share + within * share));
}
