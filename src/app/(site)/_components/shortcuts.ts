/** What a key on the front page does; `null` leaves the key to the browser. */
export type Shortcut = 'next' | 'prev' | 'open' | 'help';

/** The keys, as the help overlay lists them. */
export const SHORTCUTS: ReadonlyArray<readonly [keys: string, does: string]> = [
  ['j', 'Next story'],
  ['k', 'Previous story'],
  ['o or Enter', 'Open the focused story'],
  ['?', 'Show or hide these shortcuts'],
];

/** The minimal shape of a keydown event this module reads. */
export type KeyPress = Readonly<{
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}>;

/**
 * The shortcut a key press asks for. A press with Ctrl, Alt or Cmd is the
 * browser's (Cmd-K, Ctrl-O), so none of them is taken.
 */
export function shortcutFor(press: KeyPress): Shortcut | null {
  if (press.altKey || press.ctrlKey || press.metaKey) return null;
  switch (press.key) {
    case 'j':
      return 'next';
    case 'k':
      return 'prev';
    case 'o':
    case 'Enter':
      return 'open';
    case '?':
      return 'help';
    default:
      return null;
  }
}

/** The minimal shape of an event target this module reads. */
export type KeyTarget = Readonly<{
  tagName?: string;
  isContentEditable?: boolean;
}> | null;

/** Whether keys pressed here are being typed, so no shortcut should fire. */
export function isTyping(target: KeyTarget): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * The story to move to from `current` (-1 when none has focus yet), stopping
 * at either end rather than wrapping round.
 */
export function step(
  current: number,
  count: number,
  move: 'next' | 'prev',
): number {
  if (count <= 0) return -1;
  if (current < 0) return move === 'next' ? 0 : count - 1;
  const to = current + (move === 'next' ? 1 : -1);
  return Math.min(count - 1, Math.max(0, to));
}
