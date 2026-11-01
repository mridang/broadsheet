/**
 * @packageDocumentation
 *
 * Preferences on the wire: the representation `/api/users/self/preferences`
 * sends, and checking a change a client asks for.
 */

import type { Preferences } from '@/domain/repository';
import { INTELLIGENCE } from '@/domain/render/tiers';

/** The most days a story may wait before it counts as read anyway. */
const MAX_AUTO_READ_DAYS = 365;

/** A person's preferences as the API shows them. */
export interface PreferencesResource {
  readonly story_clustering: boolean;
  readonly cluster_mode: Preferences['cluster_mode'];
  readonly cluster_mark_read: boolean;
  readonly briefing: {
    readonly enabled: boolean;
    readonly story_count: number;
    readonly length: Preferences['briefing_length'];
    readonly style: Preferences['briefing_style'];
    readonly read_filter: Preferences['briefing_read_filter'];
  };
  readonly intelligence: Preferences['intelligence'];
  readonly mark_read_on_open: boolean;
  readonly auto_mark_read_days: number;
}

/** The story counts a note may cover. */
export const STORY_COUNTS: readonly number[] = [5, 10, 15, 20, 25];

/** The API's view of a person's preferences. */
export function preferencesResource(p: Preferences): PreferencesResource {
  return {
    story_clustering: p.story_clustering,
    cluster_mode: p.cluster_mode,
    cluster_mark_read: p.cluster_mark_read,
    briefing: {
      enabled: p.briefing_enabled,
      story_count: p.briefing_story_count,
      length: p.briefing_length,
      style: p.briefing_style,
      read_filter: p.briefing_read_filter,
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
  'briefing',
  'intelligence',
  'mark_read_on_open',
  'auto_mark_read_days',
];
const BRIEFING = ['enabled', 'story_count', 'length', 'style', 'read_filter'];

/** `value` when it is one of `allowed`, else undefined. */
const oneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined => allowed.find((a) => a === value);

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
  const changes: { -readonly [K in keyof Preferences]?: Preferences[K] } = {};
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
  if ('briefing' in body) {
    const b = body['briefing'];
    if (typeof b !== 'object' || b === null || Array.isArray(b)) {
      errors.push('briefing: must be an object.');
    } else {
      const brief = b as Record<string, unknown>;
      for (const key of Object.keys(brief)) {
        if (!BRIEFING.includes(key)) {
          errors.push(`briefing.${key}: not a briefing preference.`);
        }
      }
      if ('enabled' in brief) {
        if (typeof brief['enabled'] === 'boolean') {
          changes.briefing_enabled = brief['enabled'];
        } else errors.push('briefing.enabled: must be true or false.');
      }
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
      if ('length' in brief) {
        const v = oneOf(brief['length'], [
          'short',
          'medium',
          'detailed',
        ] as const);
        if (v) changes.briefing_length = v;
        else errors.push('briefing.length: must be short, medium or detailed.');
      }
      if ('style' in brief) {
        const v = oneOf(brief['style'], [
          'editorial',
          'bullets',
          'headlines',
        ] as const);
        if (v) changes.briefing_style = v;
        else {
          errors.push(
            'briefing.style: must be editorial, bullets or headlines.',
          );
        }
      }
      if ('read_filter' in brief) {
        const v = oneOf(brief['read_filter'], ['unread', 'focus'] as const);
        if (v) changes.briefing_read_filter = v;
        else errors.push('briefing.read_filter: must be unread or focus.');
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, changes };
}
