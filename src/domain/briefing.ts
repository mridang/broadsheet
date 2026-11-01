/**
 * @packageDocumentation
 *
 * The editor's note, as NewsBlur writes its briefing: pick the stories worth
 * a reader's attention, file each under the section that says why, and ask
 * Workers AI to write about them at the length, in the style and with the
 * model the reader chose.
 *
 * Picking: disliked stories never; with the `focus` filter only stories from
 * sources the reader trained the paper to like; unread ones, unless the
 * reader includes read ones or fewer than {@link MIN_BRIEFED} are unread; at
 * most {@link PER_SOURCE} from one source; ranked by weight, coverage, a like,
 * and a boost for sources that rarely publish. Each pick gets the first
 * personal section that fits (widely covered, from a rarely publishing source,
 * a follow-up, a trained match, a long read, else a top story); one the reader
 * turned off files under top stories. The story budget is shared among the
 * personal sections in the reader's order, the first getting most. Keyword
 * sections of the reader's own reserve up to {@link PER_PROMPT} stories each
 * beyond the budget, and the site-wide sections (most read, long reads, good
 * reads, most shared) add {@link PER_GLOBAL} each, outside the budget.
 */
import type { Article, Preferences } from '@/domain/repository';
import { coverageBoost, hostOf, weight } from '@/domain/render/tiers';
import { logWarn } from '@/utils/logging';

/** The model the note is written with when the reader chose none. */
export const BRIEFING_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

/** The Workers AI models a reader may choose to write their note. */
export const BRIEFING_MODELS: readonly string[] = [
  BRIEFING_MODEL,
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/google/gemma-3-12b-it',
];

/** Fewest stories worth a note; fewer and none is written. */
export const MIN_BRIEFED = 3;
/** Most stories one source contributes to a note. */
export const PER_SOURCE = 3;
/** Stories a keyword section reserves, and a site-wide section adds. */
export const PER_PROMPT = 2;
export const PER_GLOBAL = 3;
/** Most keyword sections, and the longest prompt, in characters. */
export const MAX_PROMPTS = 5;
export const MAX_PROMPT_LENGTH = 500;
/** Stories a month at or under which a source counts as rarely publishing. */
export const INFREQUENT = 30;
/** Words from which a story counts as a long read. */
export const LONG_READ = 800;
/** Longest note kept, in characters. */
const MAX_BRIEFING = 4000;
/** How many times the model is asked, and the wait before each retry (ms). */
const ATTEMPTS = 3;
const BACKOFF = 4000;

/** The personal sections, in the order a story is filed under the first that fits. */
export const PERSONAL_SECTIONS = [
  'widely_covered',
  'infrequent',
  'follow_up',
  'classifier_match',
  'long_read',
  'top_stories',
] as const;
/** The site-wide sections, from what everyone reads and saves. */
export const GLOBAL_SECTIONS = [
  'widely_read',
  'long_reads',
  'good_reads',
  'global_shared',
] as const;
/** The reader's own keyword sections. */
export const CUSTOM_SECTIONS = [
  'custom_1',
  'custom_2',
  'custom_3',
  'custom_4',
  'custom_5',
] as const;
/** Every section a note can have. */
export const CATEGORIES = [
  ...PERSONAL_SECTIONS,
  ...GLOBAL_SECTIONS,
  ...CUSTOM_SECTIONS,
] as const;
export type Category = (typeof CATEGORIES)[number];
export type PersonalSection = (typeof PERSONAL_SECTIONS)[number];
export type GlobalSection = (typeof GLOBAL_SECTIONS)[number];
export type CustomSection = (typeof CUSTOM_SECTIONS)[number];

/** The order sections print in when the reader chose none. */
export const DEFAULT_SECTION_ORDER: readonly Category[] = [
  'top_stories',
  'widely_covered',
  'infrequent',
  'follow_up',
  'classifier_match',
  'long_read',
  ...GLOBAL_SECTIONS,
  ...CUSTOM_SECTIONS,
];

/** How each fixed section is headed and what the model is told about it. */
const SECTIONS: Record<
  PersonalSection | GlobalSection,
  readonly [string, string]
> = {
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
  widely_read: [
    'Most read',
    'What the most readers of the paper opened, beyond the reader’s own feeds. Not the same as Widely covered.',
  ],
  long_reads: [
    'Long reads everyone is reading',
    'Long pieces many readers of the paper opened. Not the same as the reader’s own Long reads.',
  ],
  good_reads: ['Good reads', 'Stories many readers opened and kept.'],
  global_shared: [
    'Most shared',
    'Stories the most readers of the paper shared.',
  ],
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
  /** Whether a classifier likes it (dislikes never get here). */
  readonly liked: boolean;
  /** Whether a classifier likes its source, which the `focus` filter keeps. */
  readonly source_liked?: boolean;
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

/** The parts of the preferences that decide what a note covers. */
export type Selection = Pick<
  Preferences,
  | 'briefing_story_count'
  | 'briefing_read_filter'
  | 'briefing_include_read'
  | 'briefing_sections'
  | 'briefing_section_order'
  | 'briefing_prompts'
>;

/** The parts of the preferences that decide how a note reads. */
export type Writing = Pick<
  Preferences,
  | 'briefing_length'
  | 'briefing_style'
  | 'briefing_model'
  | 'briefing_section_order'
  | 'briefing_prompts'
>;

/** Defaults for the parts of {@link Selection} a caller leaves out. */
const SELECTION_DEFAULTS = {
  briefing_include_read: false,
  briefing_sections: {},
  briefing_section_order: null,
  briefing_prompts: [],
} as const;

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

/** The custom section for the reader's `n`th prompt (from 0). */
export const customSection = (n: number): CustomSection =>
  CUSTOM_SECTIONS[n] ?? 'custom_5';

/**
 * Whether a section is on: top stories always; a keyword section only when
 * the reader wrote its prompt; any other unless the reader turned it off.
 */
export function sectionOn(
  key: Category,
  prefs: Pick<Preferences, 'briefing_sections' | 'briefing_prompts'>,
): boolean {
  if (key === 'top_stories') return true;
  const custom = CUSTOM_SECTIONS.indexOf(key as CustomSection);
  if (custom >= 0 && !prefs.briefing_prompts[custom]?.trim()) return false;
  return prefs.briefing_sections[key] !== false;
}

/** Every section in the reader's order, then any they left out. */
export function sectionOrder(
  prefs: Pick<Preferences, 'briefing_section_order'>,
): Category[] {
  const chosen = (prefs.briefing_section_order ?? []).filter(
    (k): k is Category => CATEGORIES.includes(k as Category),
  );
  return [...new Set([...chosen, ...DEFAULT_SECTION_ORDER])];
}

/**
 * Share `budget` stories among `sections` in order: weights n, n-1, … 1,
 * each section at least one, the last taking what is left.
 */
export function allocate(
  budget: number,
  sections: readonly Category[],
): Map<Category, number> {
  const out = new Map<Category, number>();
  const n = sections.length;
  if (!n) return out;
  const total = (n * (n + 1)) / 2;
  let left = budget;
  sections.forEach((key, i) => {
    const share =
      i === n - 1
        ? Math.max(left, 0)
        : Math.max(1, Math.floor((budget * (n - i)) / total));
    const given = Math.min(share, Math.max(left, 0));
    out.set(key, given);
    left -= given;
  });
  return out;
}

/** The first personal section a candidate fits, before the reader's switches. */
function personalSection(
  c: Candidate,
  usedClusters: Set<number>,
): PersonalSection {
  const cluster = c.article.cluster_id;
  if (c.coverage > 1 && (cluster === null || !usedClusters.has(cluster))) {
    if (cluster !== null) usedClusters.add(cluster);
    return 'widely_covered';
  }
  if (c.monthly <= INFREQUENT) return 'infrequent';
  if (c.followed_up && !c.read) return 'follow_up';
  if (c.liked) return 'classifier_match';
  if (wordCount(c.article) >= LONG_READ) return 'long_read';
  return 'top_stories';
}

/** Extra stories for the keyword and site-wide sections, by section. */
export type ExtraSections = ReadonlyMap<
  CustomSection | GlobalSection,
  readonly Candidate[]
>;

/**
 * The stories the note covers, in section order, each with its section;
 * empty when fewer than `minimum` qualify.
 */
export function selectStories(
  candidates: readonly Candidate[],
  given: Pick<Preferences, 'briefing_story_count' | 'briefing_read_filter'> &
    Partial<Selection>,
  extra: ExtraSections = new Map(),
  minimum: number = MIN_BRIEFED,
): Choice[] {
  const prefs: Selection = { ...SELECTION_DEFAULTS, ...given };
  const allowed = candidates.filter(
    (c) =>
      prefs.briefing_read_filter !== 'focus' || (c.source_liked ?? c.liked),
  );
  const unread = allowed.filter((c) => !c.read);
  const pool =
    prefs.briefing_include_read || unread.length < MIN_BRIEFED
      ? allowed
      : unread;
  const perSource = new Map<number, number>();
  const ranked: Candidate[] = [];
  for (const c of pool.toSorted(
    (x, y) => briefingScore(y) - briefingScore(x),
  )) {
    if (ranked.length >= prefs.briefing_story_count * 3) break;
    const n = perSource.get(c.article.source_id) ?? 0;
    if (n >= PER_SOURCE) continue;
    perSource.set(c.article.source_id, n + 1);
    ranked.push(c);
  }
  const used = new Set<number>();
  const filed = ranked.map((candidate) => {
    const key = personalSection(candidate, used);
    return {
      candidate,
      category: sectionOn(key, prefs) ? key : ('top_stories' as Category),
    };
  });
  const order = sectionOrder(prefs);
  const personal = order.filter(
    (k) =>
      (PERSONAL_SECTIONS as readonly string[]).includes(k) &&
      sectionOn(k, prefs) &&
      filed.some((f) => f.category === k),
  );
  const quotas = allocate(prefs.briefing_story_count, personal);
  const chosen: Choice[] = [];
  for (const key of personal) {
    chosen.push(
      ...filed.filter((f) => f.category === key).slice(0, quotas.get(key) ?? 0),
    );
  }
  // Sections with fewer stories than their share leave room for the rest.
  for (const f of filed) {
    if (chosen.length >= prefs.briefing_story_count) break;
    if (!chosen.includes(f)) chosen.push(f);
  }
  if (chosen.length < minimum) return [];
  const taken = new Set(chosen.map((c) => c.candidate.article.id));
  const urls = new Set(chosen.map((c) => c.candidate.article.url));
  for (const key of order) {
    if (!sectionOn(key, prefs)) continue;
    const isCustom = (CUSTOM_SECTIONS as readonly string[]).includes(key);
    const isGlobal = (GLOBAL_SECTIONS as readonly string[]).includes(key);
    if (!isCustom && !isGlobal) continue;
    const pick = (extra.get(key as CustomSection | GlobalSection) ?? [])
      .filter(
        (c) =>
          !taken.has(c.article.id) &&
          !urls.has(c.article.url) &&
          (isCustom || !c.read),
      )
      .slice(0, isCustom ? PER_PROMPT : PER_GLOBAL);
    pick.forEach((c) => {
      taken.add(c.article.id);
      urls.add(c.article.url);
      chosen.push({ candidate: c, category: key });
    });
  }
  return order.flatMap((key) => chosen.filter((c) => c.category === key));
}

/** The sections a note has, in the reader's order. */
export function sectionsOf(
  picks: readonly Choice[],
  prefs: Pick<Preferences, 'briefing_section_order'> = {
    briefing_section_order: null,
  },
): Category[] {
  return sectionOrder(prefs).filter((k) => picks.some((p) => p.category === k));
}

/** A section's heading and guidance for the model. */
function sectionLine(
  key: Category,
  prompts: readonly string[],
): readonly [string, string] {
  const custom = CUSTOM_SECTIONS.indexOf(key as CustomSection);
  if (custom >= 0) {
    return [
      `A heading you write from these keywords: ${prompts[custom] ?? ''}`,
      'Stories found by the reader’s own keywords. Use only stories whose CATEGORY is this section.',
    ];
  }
  return SECTIONS[key as PersonalSection | GlobalSection];
}

/** What the model is told: the editor's job, the sections, length and style. */
export function systemPrompt(
  picks: readonly Choice[],
  given: Pick<Preferences, 'briefing_length' | 'briefing_style'> &
    Partial<Writing>,
): string {
  const prompts = given.briefing_prompts ?? [];
  const sections = sectionsOf(picks, {
    briefing_section_order: given.briefing_section_order ?? null,
  })
    .map((k, i) => {
      const [head, guide] = sectionLine(k, prompts);
      return `${i + 1}. ${head} (${k}): ${guide}`;
    })
    .join('\n');
  return (
    "You are the paper's editor, writing the reader's briefing on their " +
    'news.\n\nCover the stories in these sections, in this order, each ' +
    'under its heading on a line of its own; put each story in the section ' +
    'its CATEGORY names, and in only one section:\n' +
    sections +
    `\n\nLength: ${LENGTHS[given.briefing_length]}\n` +
    `Style: ${STYLES[given.briefing_style]}\n` +
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

/** The model a note is written with: the reader's, if it is one we offer. */
export function modelFor(choice: string | null | undefined): string {
  return choice && BRIEFING_MODELS.includes(choice) ? choice : BRIEFING_MODEL;
}

/** Wait `ms` milliseconds. */
const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A note as the model wrote it, and what writing it took. */
export interface Composed {
  readonly text: string | null;
  readonly model: string;
  readonly tokens: number | null;
  readonly seconds: number;
}

/**
 * Ask Workers AI for the note on these picks, trying {@link ATTEMPTS} times
 * with a growing wait between tries. The text is null when there is nothing
 * to cover or the model gives nothing.
 */
export async function composeBriefing(
  env: CloudflareEnv,
  picks: readonly Choice[],
  prefs: Pick<Preferences, 'briefing_length' | 'briefing_style'> &
    Partial<Writing>,
  date: string,
  wait: (ms: number) => Promise<void> = pause,
): Promise<Composed> {
  const model = modelFor(prefs.briefing_model);
  const started = Date.now();
  const done = (text: string | null, tokens: number | null): Composed => ({
    text,
    model,
    tokens,
    seconds: (Date.now() - started) / 1000,
  });
  if (!picks.length) return done(null, null);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const out = await env.AI.run(model as typeof BRIEFING_MODEL, {
        messages: [
          { role: 'system', content: systemPrompt(picks, prefs) },
          { role: 'user', content: userPrompt(picks, date) },
        ],
        max_tokens: maxTokens(picks),
      });
      const { response, usage } = out as {
        response?: unknown;
        usage?: { total_tokens?: unknown };
      };
      const note = typeof response === 'string' ? response.trim() : '';
      const tokens =
        typeof usage?.total_tokens === 'number' ? usage.total_tokens : null;
      return done(note ? note.slice(0, MAX_BRIEFING) : null, tokens);
    } catch (error) {
      logWarn({
        event: 'briefing.failed',
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
      if (attempt < ATTEMPTS) await wait(BACKOFF * attempt);
    }
  }
  return done(null, null);
}

/** The note's text alone, as {@link composeBriefing} writes it. */
export async function writeBriefing(
  env: CloudflareEnv,
  picks: readonly Choice[],
  prefs: Pick<Preferences, 'briefing_length' | 'briefing_style'> &
    Partial<Writing>,
  date: string,
  wait: (ms: number) => Promise<void> = pause,
): Promise<string | null> {
  return (await composeBriefing(env, picks, prefs, date, wait)).text;
}

/** What a stored note keeps about the stories it covers. */
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
