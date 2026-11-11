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
  if (!stored) return undefined;
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
  if (raw === null) return { ok: true, icon: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [`${field}: must be an object or null.`] };
  }
  const body = raw as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of Object.keys(body)) {
    if (!['type', 'data', 'color', 'set'].includes(key)) {
      errors.push(`${field}.${key}: not a member of an icon.`);
    }
  }
  const type = body['type'];
  const data = body['data'];
  const color = body['color'];
  const set = body['set'];
  if (!ICON_TYPES.includes(type as IconResource['type'])) {
    errors.push(`${field}.type: must be one of ${ICON_TYPES.join(', ')}.`);
  }
  if (typeof data !== 'string' || !data) {
    errors.push(`${field}.data: required.`);
  } else if (type === 'emoji' && [...data].length > 8) {
    errors.push(`${field}.data: an emoji, at most 8 characters.`);
  } else if (type === 'preset' && !/^[a-z0-9-]{1,64}$/.test(data)) {
    errors.push(
      `${field}.data: an icon name of lowercase letters, digits and hyphens.`,
    );
  } else if (
    type === 'upload' &&
    (data.length > MAX_UPLOAD_LENGTH ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data))
  ) {
    errors.push(
      `${field}.data: a data:image/png;base64 URL of at most ${MAX_UPLOAD_LENGTH} characters.`,
    );
  }
  if (
    color !== undefined &&
    (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))
  ) {
    errors.push(`${field}.color: a hex colour such as #ff5722.`);
  }
  if (
    set !== undefined &&
    (type !== 'preset' ||
      !ICON_SETS.includes(set as IconResource['set'] & string))
  ) {
    errors.push(
      `${field}.set: only for a preset icon, one of ${ICON_SETS.join(', ')}.`,
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    icon: {
      type: type as IconResource['type'],
      data: data as string,
      ...(typeof color === 'string' ? { color: color.toLowerCase() } : {}),
      ...(type === 'preset'
        ? { set: (set as IconResource['set']) ?? 'lucide' }
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
