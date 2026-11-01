/** What a key on the front page does; `null` leaves the key to the browser. */
export type Shortcut =
  | 'next'
  | 'prev'
  | 'next-unread'
  | 'next-section'
  | 'prev-section'
  | 'open'
  | 'full-text'
  | 'ask'
  | 'save'
  | 'read'
  | 'listen'
  | 'reload'
  | 'search'
  | 'help';

/** The keys, as the help overlay lists them. */
export const SHORTCUTS: ReadonlyArray<readonly [keys: string, does: string]> = [
  ['j or ↓', 'Next story'],
  ['k, p, b or ↑', 'Previous story'],
  ['n', 'Next unread story'],
  ['J or N', 'Next section'],
  ['K or P', 'Previous section'],
  ['o or Enter', 'Open the focused story'],
  ['X', 'Read the focused story’s full text'],
  ['i', 'Ask about the focused story'],
  ['s', 'Save or unsave the focused story'],
  ['u', 'Mark the focused story read or unread'],
  ['y', 'Listen to the focused story, or stop'],
  ['r', 'Reload the paper'],
  ['/', 'Search'],
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
    case 'ArrowDown':
      return 'next';
    case 'k':
    case 'p':
    case 'b':
    case 'ArrowUp':
      return 'prev';
    case 'n':
      return 'next-unread';
    case 'J':
    case 'N':
      return 'next-section';
    case 'K':
    case 'P':
      return 'prev-section';
    case 'o':
    case 'Enter':
      return 'open';
    case 'X':
      return 'full-text';
    case 'i':
      return 'ask';
    case 's':
      return 'save';
    case 'u':
      return 'read';
    case 'y':
      return 'listen';
    case 'r':
      return 'reload';
    case '/':
      return 'search';
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

/**
 * The story that has focus, by index: the one whose card holds the focused
 * element, so a story's own Listen or Save button counts as that story.
 */
export function focusedStory(
  cards: ReadonlyArray<Readonly<{ contains(node: unknown): boolean }>>,
  active: unknown,
): number {
  if (!active) return -1;
  return cards.findIndex((card) => card.contains(active));
}

/**
 * The first unread story after `current`, or -1 when every later one is read
 * (NewsBlur's `n`).
 */
export function nextUnread(read: readonly boolean[], current: number): number {
  return read.findIndex((isRead, i) => i > current && !isRead);
}

/**
 * The first story of the next or previous section, given each story's
 * section, or -1 when there is none that way. With nothing focused, the
 * next section is the first and the previous is the last.
 */
export function sectionStep(
  sections: readonly number[],
  current: number,
  move: 'next' | 'prev',
): number {
  if (!sections.length) return -1;
  const here = current < 0 ? undefined : sections[current];
  const first = (section: number) => sections.indexOf(section);
  const order = [...new Set(sections)];
  if (here === undefined) {
    return first(move === 'next' ? order[0]! : order[order.length - 1]!);
  }
  const at = order.indexOf(here) + (move === 'next' ? 1 : -1);
  return at >= 0 && at < order.length ? first(order[at]!) : -1;
}
