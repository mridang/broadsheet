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
} from '@/domain/briefing';
import { clockMinutes, isTimeZone } from '@/domain/briefings';
import { isMember } from '@/domain/members';
import { isObject } from '@/lib/core/api';
import { INTELLIGENCE } from '@/domain/render/tiers';
import type { Category } from '@/domain/briefing';
import type { Preferences } from '@/domain/repository';

const BRIEFING_CHANGES_PATTERN = /^(all|section:[1-9]\d{0,14})$/u;
const SOURCE_SECTION_PATTERN = /^section:([1-9]\d*)$/u;

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
    readonly sections: Readonly<Partial<Record<Category, boolean>>>;
    readonly section_order: readonly Category[];
    readonly prompts: readonly string[];
  };
  readonly intelligence: Preferences['intelligence'];
  readonly mark_read_on_open: boolean;
  readonly auto_mark_read_days: number;
  readonly mark_read_on_scroll: boolean;
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
const TIMES: ReadonlySet<string> = new Set([
  'auto',
  'morning',
  'afternoon',
  'evening',
]);

/** Whether a briefing section entry is a known section turned on or off. */
const isSectionFlag = (
  entry: [string, unknown],
): entry is [Category, boolean] =>
  isMember(CATEGORIES, entry[0]) && typeof entry[1] === 'boolean';

/** The API's view of a person's preferences. */
export function preferencesResource(p: Preferences): PreferencesResource {
  const order = [
    ...new Set(
      (p.briefing_section_order ?? []).filter((k): k is Category =>
        isMember(CATEGORIES, k),
      ),
    ).union(new Set(CATEGORIES)),
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
      ),
      section_order: order,
      prompts: p.briefing_prompts,
    },
    intelligence: p.intelligence,
    mark_read_on_open: p.mark_read_on_open,
    auto_mark_read_days: p.auto_mark_read_days,
    mark_read_on_scroll: p.mark_read_on_scroll,
  };
}

/** A checked change, or what was wrong with it. */
export type PreferenceChangesInput =
  | { readonly ok: true; readonly changes: Partial<Preferences> }
  | { readonly ok: false; readonly errors: readonly string[] };

const TOP = new Set([
  'story_clustering',
  'cluster_mode',
  'cluster_mark_read',
  'cluster_preview_style',
  'timezone',
  'briefing',
  'intelligence',
  'mark_read_on_open',
  'auto_mark_read_days',
  'mark_read_on_scroll',
]);
const BRIEFING = new Set([
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
]);

/** `value` when it is one of `allowed`, else undefined. */
const oneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined => allowed.find((a) => a === value);

/** A mutable change being built. */
type Changes = { -readonly [K in keyof Preferences]?: Preferences[K] };

/** What one checked member adds: the changes it makes and its errors. */
interface Part {
  readonly changes: Changes;
  readonly errors: readonly string[];
}

/** A member that was not sent: no change and no error. */
const NOT_SENT: Part = { changes: {}, errors: [] };

/** Combine checked members into one set of changes and errors. */
const combine = (parts: readonly Part[]): Part =>
  parts.reduce<Part>(
    (all, part) => ({
      changes: { ...all.changes, ...part.changes },
      errors: [...all.errors, ...part.errors],
    }),
    NOT_SENT,
  );

/** Check the members of the `briefing` object, as the changes they make. */
function briefingChanges(brief: Readonly<Record<string, unknown>>): Part {
  const flag = (key: string, change: (v: boolean) => Changes): Part => {
    if (!(key in brief)) {
      return NOT_SENT;
    }
    const v = brief[key];
    return typeof v === 'boolean'
      ? { changes: change(v), errors: [] }
      : { changes: {}, errors: [`briefing.${key}: must be true or false.`] };
  };
  const pick = <T extends string>(
    key: string,
    allowed: readonly T[],
    change: (v: T) => Changes,
  ): Part => {
    if (!(key in brief)) {
      return NOT_SENT;
    }
    const v = oneOf(brief[key], allowed);
    return v
      ? { changes: change(v), errors: [] }
      : {
          changes: {},
          errors: [`briefing.${key}: must be one of ${allowed.join(', ')}.`],
        };
  };
  const bad = (error: string): Part => ({ changes: {}, errors: [error] });
  const storyCount = (): Part => {
    const n = brief['story_count'];
    return typeof n === 'number' && STORY_COUNTS.includes(n)
      ? { changes: { briefing_story_count: n }, errors: [] }
      : bad(`briefing.story_count: must be one of ${STORY_COUNTS.join(', ')}.`);
  };
  const time = (): Part => {
    const t = brief['time'];
    const ok =
      typeof t === 'string' && (TIMES.has(t) || clockMinutes(t) !== undefined);
    return ok
      ? { changes: { briefing_time: t }, errors: [] }
      : bad(
          'briefing.time: must be auto, morning, afternoon, evening or HH:MM.',
        );
  };
  const sources = (): Part => {
    const v = brief['sources'];
    return typeof v === 'string' && BRIEFING_CHANGES_PATTERN.test(v)
      ? { changes: { briefing_sources: v }, errors: [] }
      : bad('briefing.sources: must be all or section:{id}.');
  };
  const model = (): Part => {
    const v = brief['model'];
    if (v === null) {
      return { changes: { briefing_model: null }, errors: [] };
    }
    return isMember(BRIEFING_MODELS, v)
      ? { changes: { briefing_model: v }, errors: [] }
      : bad(
          `briefing.model: must be null or one of ${BRIEFING_MODELS.join(', ')}.`,
        );
  };
  const sections = (): Part => {
    const v = brief['sections'];
    const flags = isObject(v) ? Object.entries(v) : undefined;
    return flags?.every(isSectionFlag)
      ? {
          changes: { briefing_sections: Object.fromEntries(flags) },
          errors: [],
        }
      : bad('briefing.sections: must map section keys to true or false.');
  };
  const sectionOrder = (): Part => {
    const v = brief['section_order'];
    return Array.isArray(v) &&
      v.every((k): k is Category => isMember(CATEGORIES, k)) &&
      new Set(v).size === v.length
      ? { changes: { briefing_section_order: v }, errors: [] }
      : bad('briefing.section_order: must list section keys, each once.');
  };
  const prompts = (): Part => {
    const v = brief['prompts'];
    return Array.isArray(v) &&
      v.length <= MAX_PROMPTS &&
      v.every(
        (p): p is string =>
          typeof p === 'string' && p.length <= MAX_PROMPT_LENGTH,
      )
      ? {
          changes: { briefing_prompts: v.map((p) => p.trim()) },
          errors: [],
        }
      : bad(
          `briefing.prompts: must be at most ${MAX_PROMPTS} texts of at most ${MAX_PROMPT_LENGTH} characters.`,
        );
  };
  const later: readonly (readonly [string, () => Part])[] = [
    ['time', time],
    ['sources', sources],
    ['model', model],
    ['sections', sections],
    ['section_order', sectionOrder],
    ['prompts', prompts],
  ];
  return combine([
    {
      changes: {},
      errors: Object.keys(brief)
        .filter((key) => !BRIEFING.has(key))
        .map((key) => `briefing.${key}: not a briefing preference.`),
    },
    flag('enabled', (v) => ({ briefing_enabled: v })),
    flag('include_read', (v) => ({ briefing_include_read: v })),
    'story_count' in brief ? storyCount() : NOT_SENT,
    pick('length', ['short', 'medium', 'detailed'] as const, (v) => ({
      briefing_length: v,
    })),
    pick('style', ['editorial', 'bullets', 'headlines'] as const, (v) => ({
      briefing_style: v,
    })),
    pick('read_filter', ['unread', 'focus'] as const, (v) => ({
      briefing_read_filter: v,
    })),
    pick(
      'frequency',
      ['daily', 'twice_daily', 'thrice_daily', 'weekly'] as const,
      (v) => ({ briefing_frequency: v }),
    ),
    pick('day', WEEKDAYS, (v) => ({ briefing_day: v })),
    ...later.map(([key, part]) => (key in brief ? part() : NOT_SENT)),
  ]);
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
  const flags = (
    [
      'story_clustering',
      'cluster_mark_read',
      'mark_read_on_open',
      'mark_read_on_scroll',
    ] as const
  ).map((key): Part => {
    if (!(key in body)) {
      return NOT_SENT;
    }
    const value = body[key];
    return typeof value === 'boolean'
      ? { changes: { [key]: value }, errors: [] }
      : { changes: {}, errors: [`${key}: must be true or false.`] };
  });
  const bad = (error: string): Part => ({ changes: {}, errors: [error] });
  const intelligence = (): Part => {
    const level = oneOf(body['intelligence'], INTELLIGENCE);
    return level
      ? { changes: { intelligence: level }, errors: [] }
      : bad(`intelligence: must be one of ${INTELLIGENCE.join(', ')}.`);
  };
  const autoRead = (): Part => {
    const days = body['auto_mark_read_days'];
    const ok =
      typeof days === 'number' &&
      Number.isInteger(days) &&
      days >= 0 &&
      days <= MAX_AUTO_READ_DAYS;
    return ok
      ? { changes: { auto_mark_read_days: days }, errors: [] }
      : bad(
          `auto_mark_read_days: must be a whole number from 0 to ${MAX_AUTO_READ_DAYS}.`,
        );
  };
  const clusterMode = (): Part => {
    const mode = oneOf(body['cluster_mode'], ['title', 'related'] as const);
    return mode
      ? { changes: { cluster_mode: mode }, errors: [] }
      : bad('cluster_mode: must be title or related.');
  };
  const previewStyle = (): Part => {
    const style = oneOf(body['cluster_preview_style'], [
      'single_line',
      'expanded',
    ] as const);
    return style
      ? { changes: { cluster_preview_style: style }, errors: [] }
      : bad('cluster_preview_style: must be single_line or expanded.');
  };
  const timezone = (): Part => {
    const zone = body['timezone'];
    return typeof zone === 'string' && isTimeZone(zone)
      ? { changes: { timezone: zone }, errors: [] }
      : bad('timezone: must be an IANA time zone.');
  };
  const briefing = (): Part => {
    const b = body['briefing'];
    return isObject(b)
      ? briefingChanges(b)
      : bad('briefing: must be an object.');
  };
  const members: readonly (readonly [string, () => Part])[] = [
    ['intelligence', intelligence],
    ['auto_mark_read_days', autoRead],
    ['cluster_mode', clusterMode],
    ['cluster_preview_style', previewStyle],
    ['timezone', timezone],
    ['briefing', briefing],
  ];
  const { changes, errors } = combine([
    {
      changes: {},
      errors: Object.keys(body)
        .filter((key) => !TOP.has(key))
        .map((key) => `${key}: not a preference.`),
    },
    ...flags,
    ...members.map(([key, part]) => (key in body ? part() : NOT_SENT)),
  ]);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, changes };
}

/** The section a `section:{id}` source names, or undefined for `all`. */
export function sourceSection(sources: string): number | undefined {
  const m = SOURCE_SECTION_PATTERN.exec(sources);
  return m ? Number(m[1]) : undefined;
}
