/** Join class names, skipping anything falsy: `cn('a', cond && 'b')`. */
export function cn(
  ...parts: readonly (string | false | null | undefined)[]
): string {
  return parts.filter(Boolean).join(' ');
}
