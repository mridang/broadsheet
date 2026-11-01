/**
 * @packageDocumentation
 *
 * The editor's note, as NewsBlur writes its daily briefing: pick the stories
 * worth a reader's attention, say why each was picked, and ask Workers AI to
 * write about them at the length and in the style the reader chose.
 *
 * Picking: disliked stories never; with the `focus` filter only liked ones;
 * unread ones, unless fewer than {@link MIN_BRIEFED} are unread; at most
 * {@link PER_SOURCE} from one source; ranked by weight, coverage, a like, and
 * a boost for sources that rarely publish. Each pick gets the first category
 * that fits: widely covered (several sources, one pick per cluster), from a
 * rarely publishing source, a follow-up from a source the reader reads, a
 * trained match, a long read, else a top story.
 */
import type { Article, Preferences } from '@/domain/repository';
import { coverageBoost, hostOf, weight } from '@/domain/render/tiers';
import { logWarn } from '@/utils/logging';

/** The model the editor's note is written with. */
export const BRIEFING_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

/** Fewest stories worth a note; fewer and none is written. */
export const MIN_BRIEFED = 3;
/** Most stories one source contributes to a note. */
export const PER_SOURCE = 3;
/** Stories a month at or under which a source counts as rarely publishing. */
export const INFREQUENT = 30;
/** Words from which a story counts as a long read. */
export const LONG_READ = 800;
/** Longest note kept, in characters. */
const MAX_BRIEFING = 4000;
/** How many times the model is asked, and the wait before each retry (ms). */
const ATTEMPTS = 3;
const BACKOFF = 4000;

/** Why a story is in the note, in the order the note covers them. */
export const CATEGORIES = [
  'widely_covered',
  'infrequent',
  'follow_up',
  'classifier_match',
  'long_read',
  'top_stories',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** How each category is headed and what the model is told about it. */
const SECTIONS: Record<Category, readonly [string, string]> = {
  widely_covered: [
    'Widely covered',
    'Stories several sources covered. Describe the story itself; do not list the sources.',
  ],
  infrequent: [
    'From quieter sources',
    'Stories from sources that rarely publish. Do not mention how rarely they post.',
  ],
  follow_up: [
    'Follow-ups',
    'New stories from sources the reader has been reading.',
  ],
  classifier_match: [
    'Picked for you',
    'Stories that match what the reader told the paper they like (see MATCHES).',
  ],
  long_read: [
    'Long reads',
    'Longer pieces worth the time; judge length by WORD_COUNT.',
  ],
  top_stories: ['Top stories', 'The most important of the rest.'],
};

/** How long the note is, per story and in all. */
const LENGTHS: Record<Preferences['briefing_length'], string> = {
  short: 'One sentence per story, under 300 words in all.',
  medium: 'One or two sentences per story, under 600 words in all.',
  detailed:
    'Two or three sentences of analysis per story, drawing links between stories where they exist, up to 1000 words in all.',
};

/** How the note is written. */
const STYLES: Record<Preferences['briefing_style'], string> = {
  editorial:
    'Write flowing prose that explains why each story matters, naming each story as you go.',
  bullets:
    'Write one line per story, each starting with "• " and saying what happened.',
  headlines: 'Write one line per story: just its headline.',
};

/** What is known about one story the note might cover. */
export interface Candidate {
  readonly article: Article;
  /** The reader's training: 1 likes it, 0 says nothing (dislikes never get here). */
  readonly liked: boolean;
  /** The classifiers that liked it, as `kind: value`. */
  readonly matches: readonly string[];
  readonly read: boolean;
  /** How many sources covered its story, and the others' names. */
  readonly coverage: number;
  readonly also: readonly string[];
  /** Stories its source published in the last 30 days. */
  readonly monthly: number;
  /** Whether the reader has read other stories from its source. */
  readonly followed_up: boolean;
}

/** A story the note covers and why. */
export interface Choice {
  readonly candidate: Candidate;
  readonly category: Category;
}

/** Words in a story's text (its body, else its summary). */
export function wordCount(a: Article): number {
  const text = a.body_text || a.summary || '';
  return text.split(/\s+/).filter(Boolean).length;
}

/** The boost a rarely publishing source gets: up to 2x, none above 30 a month. */
export function infrequentBoost(monthly: number): number {
  return monthly <= INFREQUENT ? 2 - Math.max(0, monthly) / INFREQUENT : 1;
}

/** How strongly a story claims a place in the note. */
export function briefingScore(c: Candidate): number {
  return (
    (weight(c.article) + coverageBoost(c.coverage) + (c.liked ? 0.5 : 0)) *
    infrequentBoost(c.monthly)
  );
}

/**
 * The stories the note covers, best first, each with the category it is
 * covered under; empty when fewer than {@link MIN_BRIEFED} qualify.
 */
export function selectStories(
  candidates: readonly Candidate[],
  prefs: Pick<Preferences, 'briefing_story_count' | 'briefing_read_filter'>,
): Choice[] {
  const allowed = candidates.filter(
    (c) => prefs.briefing_read_filter !== 'focus' || c.liked,
  );
  const unread = allowed.filter((c) => !c.read);
  const pool = unread.length >= MIN_BRIEFED ? unread : allowed;
  const perSource = new Map<number, number>();
  const chosen: Candidate[] = [];
  for (const c of pool.toSorted(
    (x, y) => briefingScore(y) - briefingScore(x),
  )) {
    if (chosen.length >= prefs.briefing_story_count) break;
    const n = perSource.get(c.article.source_id) ?? 0;
    if (n >= PER_SOURCE) continue;
    perSource.set(c.article.source_id, n + 1);
    chosen.push(c);
  }
  if (chosen.length < MIN_BRIEFED) return [];
  const clusters = new Set<number>();
  return chosen.map((c) => {
    const cluster = c.article.cluster_id;
    let category: Category;
    if (c.coverage > 1 && (cluster === null || !clusters.has(cluster))) {
      if (cluster !== null) clusters.add(cluster);
      category = 'widely_covered';
    } else if (c.monthly <= INFREQUENT) category = 'infrequent';
    else if (c.followed_up && !c.read) category = 'follow_up';
    else if (c.liked) category = 'classifier_match';
    else if (wordCount(c.article) >= LONG_READ) category = 'long_read';
    else category = 'top_stories';
    return { candidate: c, category };
  });
}

/** The sections a note has, in print order. */
export function sectionsOf(picks: readonly Choice[]): Category[] {
  return CATEGORIES.filter((k) => picks.some((p) => p.category === k));
}

/** What the model is told: the editor's job, the sections, length and style. */
export function systemPrompt(
  picks: readonly Choice[],
  prefs: Pick<Preferences, 'briefing_length' | 'briefing_style'>,
): string {
  const sections = sectionsOf(picks)
    .map((k, i) => `${i + 1}. ${SECTIONS[k][0]} (${k}): ${SECTIONS[k][1]}`)
    .join('\n');
  return (
    "You are the paper's editor, writing the editor's note at the top of " +
    "today's front page.\n\nCover the stories in these sections, in this " +
    'order, each under its heading on a line of its own; put each story in ' +
    'the section its CATEGORY names, and in only one section:\n' +
    sections +
    `\n\nLength: ${LENGTHS[prefs.briefing_length]}\n` +
    `Style: ${STYLES[prefs.briefing_style]}\n` +
    'Reply in plain text only: no HTML, no markdown, no preamble, no sign-off.'
  );
}

/** The stories as the model reads them, most important first. */
export function userPrompt(picks: readonly Choice[], date: string): string {
  return (
    `Today's date: ${date}\n\nStories, most important first:\n\n` +
    picks
      .map(({ candidate: c, category }, i) => {
        const a = c.article;
        const lines = [
          `${i + 1}. TITLE: ${a.title ?? ''}`,
          `FEED: ${a.source || hostOf(a.url)}`,
          `DATE: ${a.published_at || a.edition || ''}`,
          `CATEGORY: ${category}`,
          `READ_STATUS: ${c.read ? 'read' : 'unread'}`,
          `WORD_COUNT: ${wordCount(a)}`,
          `EXCERPT: ${(a.summary || a.body_text || '').slice(0, 300)}`,
        ];
        if (c.matches.length) lines.push(`MATCHES: ${c.matches.join(', ')}`);
        if (c.also.length) {
          lines.push(
            `CLUSTER: Also covered by: ${c.also.slice(0, 5).join(', ')}`,
          );
        }
        return lines.join('\n');
      })
      .join('\n\n')
  );
}

/** The most tokens the note may take, by how many stories and sections it has. */
export function maxTokens(picks: readonly Choice[]): number {
  return Math.min(
    1024 + 80 * picks.length + 100 * sectionsOf(picks).length,
    4096,
  );
}

/** Wait `ms` milliseconds. */
const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask Workers AI for the note on these picks, trying {@link ATTEMPTS} times
 * with a growing wait between tries. Null when there is nothing to cover or
 * the model gives nothing.
 */
export async function writeBriefing(
  env: CloudflareEnv,
  picks: readonly Choice[],
  prefs: Pick<Preferences, 'briefing_length' | 'briefing_style'>,
  date: string,
  wait: (ms: number) => Promise<void> = pause,
): Promise<string | null> {
  if (!picks.length) return null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const out = await env.AI.run(BRIEFING_MODEL, {
        messages: [
          { role: 'system', content: systemPrompt(picks, prefs) },
          { role: 'user', content: userPrompt(picks, date) },
        ],
        max_tokens: maxTokens(picks),
      });
      const text = (out as { response?: unknown }).response;
      const note = typeof text === 'string' ? text.trim() : '';
      return note ? note.slice(0, MAX_BRIEFING) : null;
    } catch (error) {
      logWarn({
        event: 'briefing.failed',
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
      if (attempt < ATTEMPTS) await wait(BACKOFF * attempt);
    }
  }
  return null;
}

/** What a stored issue keeps about its note's stories. */
export interface BriefedStory {
  readonly id: number;
  readonly category: Category;
}

/** A stored list of briefed stories read back; empty when it does not read. */
export function parseBriefedStories(stored: string | null): BriefedStory[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter(
          (s): s is BriefedStory =>
            typeof s === 'object' &&
            s !== null &&
            Number.isInteger((s as BriefedStory).id) &&
            CATEGORIES.includes((s as BriefedStory).category),
        )
      : [];
  } catch {
    return [];
  }
}
