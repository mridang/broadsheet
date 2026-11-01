/**
 * @packageDocumentation
 *
 * Preferences on the wire: the representation `/api/users/self/preferences`
 * sends, and checking a change a client asks for.
 */

import {
  BRIEFING_MODELS,
  CATEGORIES,
  MAX_PROMPTS,
  MAX_PROMPT_LENGTH,
  type Category,
} from '@/domain/briefing';
import { clockMinutes, isTimeZone } from '@/domain/briefings';
import type { Preferences } from '@/domain/repository';
import { INTELLIGENCE } from '@/domain/render/tiers';

/** The most days a story may wait before it counts as read anyway. */
const MAX_AUTO_READ_DAYS = 365;

/** A person's preferences as the API shows them. */
export interface PreferencesResource {
  readonly story_clustering: boolean;
  readonly cluster_mode: Preferences['cluster_mode'];
  readonly cluster_mark_read: boolean;
  readonly cluster_preview_style: Preferences['cluster_preview_style'];
  readonly timezone: string;
  readonly briefing: {
    readonly enabled: boolean;
    readonly story_count: number;
    readonly length: Preferences['briefing_length'];
    readonly style: Preferences['briefing_style'];
    readonly read_filter: Preferences['briefing_read_filter'];
    readonly frequency: Preferences['briefing_frequency'];
    readonly time: string;
    readonly day: string;
    readonly sources: string;
    readonly include_read: boolean;
    readonly model?: string;
    readonly sections: Readonly<Record<Category, boolean>>;
    readonly section_order: readonly Category[];
    readonly prompts: readonly string[];
  };
  readonly intelligence: Preferences['intelligence'];
  readonly mark_read_on_open: boolean;
  readonly auto_mark_read_days: number;
}

/** The story counts a note may cover. */
export const STORY_COUNTS: readonly number[] = [5, 10, 15, 20, 25];
/** The weekdays a weekly briefing may come on. */
export const WEEKDAYS: readonly string[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
];
/** The times of day a briefing may come at, besides one written HH:MM. */
const TIMES: readonly string[] = ['auto', 'morning', 'afternoon', 'evening'];

/** The API's view of a person's preferences. */
export function preferencesResource(p: Preferences): PreferencesResource {
  const order = [
    ...new Set([
      ...(p.briefing_section_order ?? []).filter((k): k is Category =>
        CATEGORIES.includes(k as Category),
      ),
      ...CATEGORIES,
    ]),
  ];
  return {
    story_clustering: p.story_clustering,
    cluster_mode: p.cluster_mode,
    cluster_mark_read: p.cluster_mark_read,
    cluster_preview_style: p.cluster_preview_style,
    timezone: p.timezone,
    briefing: {
      enabled: p.briefing_enabled,
      story_count: p.briefing_story_count,
      length: p.briefing_length,
      style: p.briefing_style,
      read_filter: p.briefing_read_filter,
      frequency: p.briefing_frequency,
      time: p.briefing_time,
      day: p.briefing_day,
      sources: p.briefing_sources,
      include_read: p.briefing_include_read,
      ...(p.briefing_model ? { model: p.briefing_model } : {}),
      sections: Object.fromEntries(
        CATEGORIES.map((k) => [k, p.briefing_sections[k] !== false]),
      ) as Record<Category, boolean>,
      section_order: order,
      prompts: p.briefing_prompts,
    },
    intelligence: p.intelligence,
    mark_read_on_open: p.mark_read_on_open,
    auto_mark_read_days: p.auto_mark_read_days,
  };
}

/** A checked change, or what was wrong with it. */
export type PreferenceChangesInput =
  | { readonly ok: true; readonly changes: Partial<Preferences> }
  | { readonly ok: false; readonly errors: readonly string[] };

const TOP = [
  'story_clustering',
  'cluster_mode',
  'cluster_mark_read',
  'cluster_preview_style',
  'timezone',
  'briefing',
  'intelligence',
  'mark_read_on_open',
  'auto_mark_read_days',
];
const BRIEFING = [
  'enabled',
  'story_count',
  'length',
  'style',
  'read_filter',
  'frequency',
  'time',
  'day',
  'sources',
  'include_read',
  'model',
  'sections',
  'section_order',
  'prompts',
];

/** `value` when it is one of `allowed`, else undefined. */
const oneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined => allowed.find((a) => a === value);

/** A mutable change being built. */
type Changes = { -readonly [K in keyof Preferences]?: Preferences[K] };

/** Check the members of the `briefing` object, adding to `changes`. */
function briefingChanges(
  brief: Readonly<Record<string, unknown>>,
  changes: Changes,
  errors: string[],
): void {
  for (const key of Object.keys(brief)) {
    if (!BRIEFING.includes(key)) {
      errors.push(`briefing.${key}: not a briefing preference.`);
    }
  }
  const flag = (key: string, set: (v: boolean) => void) => {
    if (!(key in brief)) return;
    const v = brief[key];
    if (typeof v === 'boolean') set(v);
    else errors.push(`briefing.${key}: must be true or false.`);
  };
  const pick = <T extends string>(
    key: string,
    allowed: readonly T[],
    set: (v: T) => void,
  ) => {
    if (!(key in brief)) return;
    const v = oneOf(brief[key], allowed);
    if (v) set(v);
    else errors.push(`briefing.${key}: must be one of ${allowed.join(', ')}.`);
  };
  flag('enabled', (v) => (changes.briefing_enabled = v));
  flag('include_read', (v) => (changes.briefing_include_read = v));
  if ('story_count' in brief) {
    const n = brief['story_count'];
    if (typeof n === 'number' && STORY_COUNTS.includes(n)) {
      changes.briefing_story_count = n;
    } else {
      errors.push(
        `briefing.story_count: must be one of ${STORY_COUNTS.join(', ')}.`,
      );
    }
  }
  pick(
    'length',
    ['short', 'medium', 'detailed'] as const,
    (v) => (changes.briefing_length = v),
  );
  pick(
    'style',
    ['editorial', 'bullets', 'headlines'] as const,
    (v) => (changes.briefing_style = v),
  );
  pick(
    'read_filter',
    ['unread', 'focus'] as const,
    (v) => (changes.briefing_read_filter = v),
  );
  pick(
    'frequency',
    ['daily', 'twice_daily', 'thrice_daily', 'weekly'] as const,
    (v) => (changes.briefing_frequency = v),
  );
  pick('day', WEEKDAYS, (v) => (changes.briefing_day = v));
  if ('time' in brief) {
    const t = brief['time'];
    if (
      typeof t === 'string' &&
      (TIMES.includes(t) || clockMinutes(t) !== undefined)
    ) {
      changes.briefing_time = t;
    } else {
      errors.push(
        'briefing.time: must be auto, morning, afternoon, evening or HH:MM.',
      );
    }
  }
  if ('sources' in brief) {
    const v = brief['sources'];
    if (typeof v === 'string' && /^(all|section:[1-9]\d{0,14})$/.test(v)) {
      changes.briefing_sources = v;
    } else errors.push('briefing.sources: must be all or section:{id}.');
  }
  if ('model' in brief) {
    const v = brief['model'];
    if (v === null) changes.briefing_model = null;
    else if (typeof v === 'string' && BRIEFING_MODELS.includes(v)) {
      changes.briefing_model = v;
    } else {
      errors.push(
        `briefing.model: must be null or one of ${BRIEFING_MODELS.join(', ')}.`,
      );
    }
  }
  if ('sections' in brief) {
    const v = brief['sections'];
    if (
      typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v) &&
      Object.entries(v).every(
        ([k, on]) =>
          CATEGORIES.includes(k as Category) && typeof on === 'boolean',
      )
    ) {
      changes.briefing_sections = v as Record<string, boolean>;
    } else {
      errors.push('briefing.sections: must map section keys to true or false.');
    }
  }
  if ('section_order' in brief) {
    const v = brief['section_order'];
    if (
      Array.isArray(v) &&
      v.every((k) => CATEGORIES.includes(k as Category)) &&
      new Set(v).size === v.length
    ) {
      changes.briefing_section_order = v as Category[];
    } else {
      errors.push('briefing.section_order: must list section keys, each once.');
    }
  }
  if ('prompts' in brief) {
    const v = brief['prompts'];
    if (
      Array.isArray(v) &&
      v.length <= MAX_PROMPTS &&
      v.every((p) => typeof p === 'string' && p.length <= MAX_PROMPT_LENGTH)
    ) {
      changes.briefing_prompts = (v as string[]).map((p) => p.trim());
    } else {
      errors.push(
        `briefing.prompts: must be at most ${MAX_PROMPTS} texts of at most ${MAX_PROMPT_LENGTH} characters.`,
      );
    }
  }
}

/**
 * Check the body of `PATCH /api/users/self/preferences`: any of the members
 * of {@link PreferencesResource}, each of its own type (`intelligence` one of
 * focus, unread or all; `auto_mark_read_days` a whole number of days, 0
 * never). Unknown members are
 * refused.
 */
export function parsePreferenceChanges(
  body: Readonly<Record<string, unknown>>,
): PreferenceChangesInput {
  const errors: string[] = [];
  const changes: Changes = {};
  for (const key of Object.keys(body)) {
    if (!TOP.includes(key)) errors.push(`${key}: not a preference.`);
  }
  for (const key of [
    'story_clustering',
    'cluster_mark_read',
    'mark_read_on_open',
  ] as const) {
    if (!(key in body)) continue;
    const value = body[key];
    if (typeof value === 'boolean') changes[key] = value;
    else errors.push(`${key}: must be true or false.`);
  }
  if ('intelligence' in body) {
    const level = oneOf(body['intelligence'], INTELLIGENCE);
    if (level) changes.intelligence = level;
    else
      errors.push(`intelligence: must be one of ${INTELLIGENCE.join(', ')}.`);
  }
  if ('auto_mark_read_days' in body) {
    const days = body['auto_mark_read_days'];
    if (
      typeof days === 'number' &&
      Number.isInteger(days) &&
      days >= 0 &&
      days <= MAX_AUTO_READ_DAYS
    ) {
      changes.auto_mark_read_days = days;
    } else
      errors.push(
        `auto_mark_read_days: must be a whole number from 0 to ${MAX_AUTO_READ_DAYS}.`,
      );
  }
  if ('cluster_mode' in body) {
    const mode = oneOf(body['cluster_mode'], ['title', 'related'] as const);
    if (mode) changes.cluster_mode = mode;
    else errors.push('cluster_mode: must be title or related.');
  }
  if ('cluster_preview_style' in body) {
    const style = oneOf(body['cluster_preview_style'], [
      'single_line',
      'expanded',
    ] as const);
    if (style) changes.cluster_preview_style = style;
    else {
      errors.push('cluster_preview_style: must be single_line or expanded.');
    }
  }
  if ('timezone' in body) {
    const zone = body['timezone'];
    if (typeof zone === 'string' && isTimeZone(zone)) changes.timezone = zone;
    else errors.push('timezone: must be an IANA time zone.');
  }
  if ('briefing' in body) {
    const b = body['briefing'];
    if (typeof b !== 'object' || b === null || Array.isArray(b)) {
      errors.push('briefing: must be an object.');
    } else {
      briefingChanges(b as Record<string, unknown>, changes, errors);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, changes };
}

/** The section a `section:{id}` source names, or undefined for `all`. */
export function sourceSection(sources: string): number | undefined {
  const m = /^section:([1-9]\d*)$/.exec(sources);
  return m ? Number(m[1]) : undefined;
}
