/**
 * @packageDocumentation
 *
 * Briefings on a schedule, as NewsBlur sends them: daily, twice or three
 * times a day, or weekly, at a slot of the reader's own day (morning 08:30,
 * afternoon 12:30, evening 17:00, or a time they pick), in their time zone.
 * A briefing reads the stories fetched since the last one could have been
 * (a day, 12 or 8 hours, a week), leaves out stories an earlier briefing in
 * that window covered, and is written as {@link selectStories} and
 * {@link composeBriefing} say. One briefing is kept per slot and local date;
 * asking for one again replaces it.
 */
import type { Database } from '@/domain/db/database';
import {
  GLOBAL_SECTIONS,
  LONG_READ,
  MIN_BRIEFED,
  composeBriefing,
  customSection,
  parseBriefedStories,
  sectionOn,
  sectionsOf,
  selectStories,
  wordCount,
  type Candidate,
  type Choice,
  type CustomSection,
  type GlobalSection,
} from '@/domain/briefing';
import {
  Repository,
  sectionAndDescendants,
  type Article,
  type Preferences,
  type StoredBriefing,
} from '@/domain/repository';
import {
  formatEdition,
  hostOf,
  matches,
  verdict,
  type Training,
} from '@/domain/render/tiers';

/** The fixed slots of a reader's day, as minutes after midnight. */
export const SLOTS = {
  morning: 8 * 60 + 30,
  afternoon: 12 * 60 + 30,
  evening: 17 * 60,
} as const;
export type FixedSlot = keyof typeof SLOTS;
/** A slot: one of the fixed ones, or `custom` at the reader's own time. */
export type Slot = FixedSlot | 'custom';

/** How long before its slot a briefing is written, and how long after it may be. */
export const LEAD_MINUTES = 5;
export const GRACE_MINUTES = 55;

/** How far back a briefing reads, in hours, by how often it comes. */
export const LOOKBACK_HOURS: Record<Preferences['briefing_frequency'], number> =
  {
    daily: 24,
    twice_daily: 12,
    thrice_daily: 8,
    weekly: 7 * 24,
  };

/** A moment as the reader's clock and calendar show it. */
export interface LocalTime {
  /** YYYY-MM-DD. */
  readonly date: string;
  /** Minutes after local midnight. */
  readonly minutes: number;
  /** `sun` to `sat`. */
  readonly weekday: string;
}

/** Whether `zone` is an IANA time zone this runtime knows. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** `now` on the clock of `zone` (UTC when the zone is not one). */
export function localTime(now: Date, zone: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: isTimeZone(zone) ? zone : 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minutes: Number(part('hour')) * 60 + Number(part('minute')),
    weekday: part('weekday').toLowerCase().slice(0, 3),
  };
}

/** Minutes after midnight for a time written HH:MM, or undefined. */
export function clockMinutes(time: string): number | undefined {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

/** The slot and time the reader prefers (`auto` is the morning). */
export function preferredSlot(time: string): {
  readonly slot: Slot;
  readonly at: number;
} {
  const custom = clockMinutes(time);
  if (custom !== undefined) return { slot: 'custom', at: custom };
  const fixed: FixedSlot =
    time === 'afternoon' || time === 'evening' ? time : 'morning';
  return { slot: fixed, at: SLOTS[fixed] };
}

/**
 * The slots a reader's briefings come at on a day: the preferred one for a
 * daily or weekly briefing (weekly only on the chosen weekday), the morning
 * and the preferred one (the afternoon when that is the morning) twice a
 * day, and all three fixed slots three times a day.
 */
export function slotsFor(
  prefs: Pick<
    Preferences,
    'briefing_frequency' | 'briefing_time' | 'briefing_day'
  >,
  weekday: string,
): { readonly slot: Slot; readonly at: number }[] {
  const preferred = preferredSlot(prefs.briefing_time);
  switch (prefs.briefing_frequency) {
    case 'weekly':
      return weekday === prefs.briefing_day ? [preferred] : [];
    case 'twice_daily':
      return [
        { slot: 'morning', at: SLOTS.morning },
        preferred.slot === 'morning'
          ? { slot: 'afternoon', at: SLOTS.afternoon }
          : preferred,
      ];
    case 'thrice_daily':
      return (Object.keys(SLOTS) as FixedSlot[]).map((slot) => ({
        slot,
        at: SLOTS[slot],
      }));
    default:
      return [preferred];
  }
}

/**
 * The slots due for a reader at `now`: those whose time is from
 * {@link LEAD_MINUTES} before to {@link GRACE_MINUTES} after the reader's
 * local time, with the local date each is for.
 */
export function dueSlots(
  prefs: Pick<
    Preferences,
    | 'briefing_enabled'
    | 'briefing_frequency'
    | 'briefing_time'
    | 'briefing_day'
    | 'timezone'
  >,
  now: Date,
): { readonly slot: Slot; readonly date: string }[] {
  if (!prefs.briefing_enabled) return [];
  const local = localTime(now, prefs.timezone);
  return slotsFor(prefs, local.weekday)
    .filter(
      ({ at }) =>
        local.minutes >= at - LEAD_MINUTES &&
        local.minutes < at + GRACE_MINUTES,
    )
    .map(({ slot }) => ({ slot, date: local.date }));
}

/** The slot a reader is in at `now`, for a briefing they ask for. */
export function currentSlot(now: Date, zone: string): FixedSlot {
  const { minutes } = localTime(now, zone);
  if (minutes >= SLOTS.evening) return 'evening';
  if (minutes >= SLOTS.afternoon) return 'afternoon';
  return 'morning';
}

/** "Morning Daily Briefing — Sunday, November 1, 2026", by slot and day. */
export function briefingTitle(
  slot: Slot,
  at: number,
  frequency: Preferences['briefing_frequency'],
  localDate: string,
): string {
  const part =
    slot !== 'custom'
      ? slot
      : at >= SLOTS.evening
        ? 'evening'
        : at >= SLOTS.afternoon
          ? 'afternoon'
          : 'morning';
  const kind = frequency === 'weekly' ? 'Weekly' : 'Daily';
  return `${part[0]?.toUpperCase()}${part.slice(1)} ${kind} Briefing — ${formatEdition(localDate)}`;
}

/** A moment as SQLite's `datetime('now')` writes it. */
export function sqliteTime(at: Date): string {
  return at.toISOString().slice(0, 19).replace('T', ' ');
}

/** The classifiers that like a story, as `kind: value`. */
function likedBy(a: Article, training: readonly Training[]): string[] {
  return training
    .filter((c) => c.score > 0 && matches(a, c))
    .map((c) => `${c.kind}: ${c.value}`);
}

/** Whether a classifier likes the story's source. */
function sourceLiked(a: Article, training: readonly Training[]): boolean {
  return training.some(
    (c) =>
      c.kind === 'source' &&
      c.score > 0 &&
      matches({ title: null, source: a.source || hostOf(a.url) }, c),
  );
}

/** A story to decorate, with what its cluster says about it. */
export interface Entry {
  readonly article: Article;
  readonly also?: readonly string[];
  readonly coverage?: number;
}

/**
 * Candidates for a note from these entries: the reader's training, reads
 * and how often each source published since `monthStart` (YYYY-MM-DD,
 * thirty days back) decide each one's place. Disliked
 * stories and those at addresses in `covered` are left out.
 */
export async function toCandidates(
  repo: Repository,
  readerId: number,
  entries: readonly Entry[],
  monthStart: string,
  covered: ReadonlySet<string> = new Set(),
): Promise<Candidate[]> {
  const [training, reads, readSources] = await Promise.all([
    repo.listClassifiers(readerId),
    repo.readState(readerId),
    repo.readSourceIds(readerId),
  ]);
  const kept = entries.filter(
    ({ article }) =>
      !covered.has(article.url) && verdict(article, training) >= 0,
  );
  const monthly = await repo.sourceCounts(
    kept.map(({ article }) => article.source_id),
    monthStart,
  );
  return kept.map(({ article: a, also = [], coverage = 1 }) => ({
    article: a,
    liked: verdict(a, training) > 0,
    source_liked: sourceLiked(a, training),
    matches: likedBy(a, training),
    read: reads.ids.has(a.id),
    coverage,
    also,
    monthly: monthly.get(a.source_id) ?? 0,
    followed_up: readSources.has(a.source_id),
  }));
}

/**
 * Entries for stories read alone, with what their cluster says: the other
 * sources in the same set that carried the story.
 */
export function clusterEntries(list: readonly Article[]): Entry[] {
  const byCluster = new Map<number, Article[]>();
  for (const a of list) {
    if (a.cluster_id === null) continue;
    byCluster.set(a.cluster_id, [...(byCluster.get(a.cluster_id) ?? []), a]);
  }
  return list.map((article) => {
    const group =
      article.cluster_id === null
        ? []
        : (byCluster.get(article.cluster_id) ?? []);
    const name = (a: Article) => a.source || hostOf(a.url);
    return {
      article,
      coverage: Math.max(1, new Set(group.map((a) => a.source_id)).size),
      also: [...new Set(group.filter((a) => a.id !== article.id).map(name))],
    };
  });
}

/** The addresses of the stories these stored story lists covered. */
export async function coveredUrls(
  repo: Repository,
  stored: readonly (string | null | undefined)[],
): Promise<Set<string>> {
  const ids = stored.flatMap((s) =>
    parseBriefedStories(s ?? null).map((b) => b.id),
  );
  if (!ids.length) return new Set();
  return new Set((await repo.articlesByIds(ids)).map((a) => a.url));
}

/** The source ids a briefing reads: all, or one section's and its nested ones'. */
async function sourcesFor(
  repo: Repository,
  userId: number,
  sources: string,
): Promise<number[] | undefined> {
  const m = /^section:([1-9]\d*)$/.exec(sources);
  if (!m) return undefined;
  const sections = await repo.listSections(userId);
  const ids = sectionAndDescendants(sections, Number(m[1]));
  return (await repo.listFeeds(userId))
    .filter((f) => f.section_id !== null && ids.has(f.section_id))
    .map((f) => f.source_id);
}

/** The stories for the keyword and site-wide sections. */
async function extraSections(
  repo: Repository,
  userId: number,
  prefs: Preferences,
  since: string,
): Promise<Map<CustomSection | GlobalSection, Article[]>> {
  const extra = new Map<CustomSection | GlobalSection, Article[]>();
  for (const [i, prompt] of prefs.briefing_prompts.entries()) {
    const key = customSection(i);
    if (!sectionOn(key, prefs) || !prompt.trim()) continue;
    // A phrase search first, then every word of three letters or more.
    let found = await repo.searchSince(userId, prompt, since);
    if (!found.length) {
      const words = prompt.split(/\s+/).filter((w) => w.length >= 3);
      if (words.length) {
        found = await repo.searchSince(userId, words.join(' '), since);
      }
    }
    extra.set(key, found);
  }
  const want = (key: GlobalSection) => sectionOn(key, prefs);
  const any = GLOBAL_SECTIONS.some(want);
  const [read, saved, shared] = await Promise.all([
    any ? repo.popularArticles('reads', since, 12) : [],
    any ? repo.popularArticles('saves', since, 12) : [],
    want('global_shared') ? repo.popularArticles('shares', since, 12) : [],
  ]);
  const savedIds = new Set(saved.map((s) => s.article.id));
  if (want('widely_read'))
    extra.set(
      'widely_read',
      read.map((r) => r.article),
    );
  if (want('long_reads')) {
    extra.set(
      'long_reads',
      read.map((r) => r.article).filter((a) => wordCount(a) >= LONG_READ),
    );
  }
  if (want('good_reads')) {
    extra.set(
      'good_reads',
      read.map((r) => r.article).filter((a) => savedIds.has(a.id)),
    );
  }
  if (want('global_shared')) {
    extra.set(
      'global_shared',
      shared.map((s) => s.article),
    );
  }
  return extra;
}

/** What writing a briefing did. */
export interface Written {
  readonly briefing: StoredBriefing | undefined;
  /** Whether it replaced one already stored for the slot and day. */
  readonly replaced: boolean;
  /** Why none was written, when none was. */
  readonly skipped?: string;
}

/**
 * Write and store a reader's briefing for `slot` on `localDate`, reading the
 * stories fetched in the window before `now`. Nothing is stored when too few
 * stories qualify; a briefing the model could not write is stored as failed.
 */
export async function writeScheduledBriefing(
  db: Database,
  env: CloudflareEnv,
  userId: number,
  slot: Slot,
  localDate: string,
  now: Date = new Date(),
): Promise<Written> {
  const repo = new Repository(db);
  const prefs = await repo.getPreferences(userId);
  const start = new Date(
    now.getTime() - LOOKBACK_HOURS[prefs.briefing_frequency] * 3600000,
  );
  const since = sqliteTime(start);
  const sources = await sourcesFor(repo, userId, prefs.briefing_sources);
  const covered = await coveredUrls(
    repo,
    await repo.briefedSince(userId, since, { slot, date: localDate }),
  );
  const articles = await repo.briefingArticles(userId, since, sources);
  const monthStart = new Date(now.getTime() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const candidates = await toCandidates(
    repo,
    userId,
    clusterEntries(articles),
    monthStart,
    covered,
  );
  const extraArticles = await extraSections(repo, userId, prefs, since);
  const extra = new Map<CustomSection | GlobalSection, Candidate[]>();
  for (const [key, list] of extraArticles) {
    extra.set(
      key,
      await toCandidates(
        repo,
        userId,
        clusterEntries(list),
        monthStart,
        covered,
      ),
    );
  }
  const minimum =
    prefs.briefing_frequency === 'twice_daily' ||
    prefs.briefing_frequency === 'thrice_daily'
      ? 1
      : MIN_BRIEFED;
  const picks = selectStories(candidates, prefs, extra, minimum);
  if (!picks.length) {
    return {
      briefing: undefined,
      replaced: false,
      skipped: 'Too few stories.',
    };
  }
  const previous = await repo.findBriefing(userId, slot, localDate);
  const composed = await composeBriefing(env, picks, prefs, localDate);
  const briefing = await repo.saveBriefing({
    user_id: userId,
    slot,
    local_date: localDate,
    frequency: prefs.briefing_frequency,
    period_start: start.toISOString(),
    title: briefingTitle(
      slot,
      preferredSlot(prefs.briefing_time).at,
      prefs.briefing_frequency,
      localDate,
    ),
    summary: composed.text,
    stories: JSON.stringify(storiesOf(picks)),
    sections: JSON.stringify(sectionsOf(picks, prefs)),
    status: composed.text ? 'complete' : 'failed',
    error: composed.text ? null : 'Summary generation failed.',
    model: composed.model,
    tokens: composed.tokens,
    seconds: composed.seconds,
  });
  return { briefing, replaced: previous !== undefined };
}

/** What a stored briefing keeps about its picks. */
function storiesOf(picks: readonly Choice[]) {
  return picks.map((p) => ({
    id: p.candidate.article.id,
    category: p.category,
  }));
}
