/**
 * @packageDocumentation
 *
 * Telling whether a value read from outside is one of a fixed list, in a way
 * the compiler follows: the check narrows the value to the list's members.
 */

/** Whether `value` is one of the strings in `list`. */
export function isMember<const T extends readonly string[]>(
  list: T,
  value: unknown,
): value is T[number] {
  return (list as readonly unknown[]).includes(value);
}
