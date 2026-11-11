/** A class name, or a falsy value that is skipped. */
type ClassPart = string | false | null | undefined;

/** Join class names, skipping anything falsy: `cn('a', cond && 'b')`. */
export function cn(...parts: readonly ClassPart[]): string {
  return parts.filter(Boolean).join(' ');
}
