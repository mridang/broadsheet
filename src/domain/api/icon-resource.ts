import { isObject } from '@/lib/core/api';
import { isMember } from '@/domain/members';

const PARSE_ICON_PATTERN = /^[a-z0-9-]{1,64}$/u;
const PARSE_ICON_PATTERN_2 = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u;
const PARSE_ICON_PATTERN_3 = /^#[0-9a-f]{6}$/iu;
const CODE_POINT_PATTERN = /./gsu;
/**
 * @packageDocumentation
 *
 * Custom icons on the wire, for sections and feeds as NewsBlur has them for
 * folders and feeds: an emoji, a named icon from a preset set, or an uploaded
 * PNG, each with an optional colour. Stored as JSON in one column.
 */

/** The kinds of custom icon. */
export const ICON_TYPES = ['emoji', 'preset', 'upload'] as const;

/** The preset icon sets a named icon comes from. */
export const ICON_SETS = ['lucide', 'heroicons-solid'] as const;

/** Longest uploaded icon accepted, as a data URL, in characters. */
export const MAX_UPLOAD_LENGTH = 100_000;

/** A custom icon as the API shows it and accepts it. */
export interface IconResource {
  readonly type: (typeof ICON_TYPES)[number];
  /** The emoji, the icon's name, or a `data:image/png;base64,` URL. */
  readonly data: string;
  /** A hex colour such as `#ff5722`. */
  readonly color?: string;
  /** For a preset icon, the set it comes from. */
  readonly set?: (typeof ICON_SETS)[number];
}

/** A stored icon as the API shows it, or undefined when there is none. */
export function iconResource(stored: string | null): IconResource | undefined {
  if (!stored) {
    return undefined;
  }
  try {
    const parsed = parseIcon(JSON.parse(stored) as unknown, 'icon');
    return parsed.ok && parsed.icon ? parsed.icon : undefined;
  } catch {
    return undefined;
  }
}

/** A checked icon (null to clear it), or what was wrong with it. */
export type IconInput =
  | { readonly ok: true; readonly icon: IconResource | null }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Check an icon given as the member `field` of a body. */
export function parseIcon(raw: unknown, field: string): IconInput {
  if (raw === null) {
    return { ok: true, icon: null };
  }
  if (!isObject(raw)) {
    return { ok: false, errors: [`${field}: must be an object or null.`] };
  }
  const body = raw;
  const type = body['type'];
  const color = body['color'];
  const set = body['set'];
  const data =
    typeof body['data'] === 'string' && body['data'] !== ''
      ? body['data']
      : undefined;
  const missing = data === undefined;
  const emojiLong =
    !missing &&
    type === 'emoji' &&
    (data.match(CODE_POINT_PATTERN) ?? []).length > 8;
  const dataFine = !missing && !emojiLong;
  const presetBad =
    dataFine && type === 'preset' && !PARSE_ICON_PATTERN.test(data);
  const uploadBad =
    dataFine &&
    type === 'upload' &&
    (data.length > MAX_UPLOAD_LENGTH || !PARSE_ICON_PATTERN_2.test(data));
  const errors: string[] = [
    ...Object.keys(body)
      .filter((key) => !['type', 'data', 'color', 'set'].includes(key))
      .map((key) => `${field}.${key}: not a member of an icon.`),
    ...(isMember(ICON_TYPES, type)
      ? []
      : [`${field}.type: must be one of ${ICON_TYPES.join(', ')}.`]),
    ...(missing ? [`${field}.data: required.`] : []),
    ...(emojiLong ? [`${field}.data: an emoji, at most 8 characters.`] : []),
    ...(presetBad
      ? [
          `${field}.data: an icon name of lowercase letters, digits and hyphens.`,
        ]
      : []),
    ...(uploadBad
      ? [
          `${field}.data: a data:image/png;base64 URL of at most ${MAX_UPLOAD_LENGTH} characters.`,
        ]
      : []),
    ...(color !== undefined &&
    (typeof color !== 'string' || !PARSE_ICON_PATTERN_3.test(color))
      ? [`${field}.color: a hex colour such as #ff5722.`]
      : []),
    ...(set !== undefined && (type !== 'preset' || !isMember(ICON_SETS, set))
      ? [
          `${field}.set: only for a preset icon, one of ${ICON_SETS.join(', ')}.`,
        ]
      : []),
  ];
  if (errors.length > 0 || !isMember(ICON_TYPES, type) || data === undefined) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    icon: {
      type,
      data,
      ...(typeof color === 'string' ? { color: color.toLowerCase() } : {}),
      ...(type === 'preset'
        ? { set: isMember(ICON_SETS, set) ? set : 'lucide' }
        : {}),
    },
  };
}

/** Whether `raw` is a number of days for auto mark-read: 0 (never) to 365. */
export function isAutoMarkReadDays(raw: unknown): raw is number {
  return (
    typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 365
  );
}
