/** What a key on the front page does; `null` leaves the key to the browser. */
export type Shortcut =
  | 'next'
  | 'prev'
  | 'next-unread'
  | 'last-unread'
  | 'next-section'
  | 'prev-section'
  | 'go-section'
  | 'older-edition'
  | 'newer-edition'
  | 'everything'
  | 'deselect'
  | 'open'
  | 'open-background'
  | 'full-text'
  | 'collapse'
  | 'expand'
  | 'comments'
  | 'ask'
  | 'save'
  | 'read'
  | 'read-all'
  | 'read-above'
  | 'read-below'
  | 'listen'
  | 'reload'
  | 'refresh'
  | 'search'
  | 'fullscreen'
  | 'masthead'
  | 'theme'
  | 'help';

/** The keys, as the help overlay lists them. */
export const SHORTCUTS: ReadonlyArray<readonly [keys: string, does: string]> = [
  ['j or ↓', 'Next story'],
  ['k, p, b or ↑', 'Previous story'],
  ['n', 'Next unread story'],
  ['M', 'Last unread story'],
  ['J, N or Shift ↓', 'Next section'],
  ['K, P or Shift ↑', 'Previous section'],
  ['g', 'Go to a section'],
  ['h or ←', 'Previous day’s edition'],
  ['l or →', 'Next day’s edition'],
  ['E', 'Today’s paper'],
  ['Esc', 'Leave the focused story'],
  ['o or Enter', 'Open the focused story'],
  ['Ctrl or ⌘ Enter', 'Open it in a background tab'],
  ['Shift Enter', 'Read its full text'],
  ['x', 'Collapse the focused story'],
  ['X', 'Expand the focused story'],
  ['c', 'Open its discussion'],
  ['i', 'Ask about the focused story'],
  ['s', 'Save or unsave the focused story'],
  ['u', 'Mark the focused story read or unread'],
  ['A', 'Mark every story read'],
  ['B', 'Mark the stories above read'],
  ['Y', 'Mark the stories below read'],
  ['y', 'Listen to the focused story, or stop'],
  ['r', 'Reload the paper'],
  ['R', 'Fetch every feed again now'],
  ['/', 'Search'],
  ['F', 'Full screen'],
  ['U', 'Hide or show the masthead'],
  ['S', 'Switch the paper’s style'],
  ['?', 'Show or hide these shortcuts'],
];

/** The minimal shape of a keydown event this module reads. */
export type KeyPress = Readonly<{
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}>;

/** The single keys, as `KeyboardEvent.key` names them (Shift gives capitals). */
const KEYS: Readonly<Record<string, Shortcut>> = {
  j: 'next',
  ArrowDown: 'next',
  k: 'prev',
  p: 'prev',
  b: 'prev',
  ArrowUp: 'prev',
  n: 'next-unread',
  M: 'last-unread',
  J: 'next-section',
  N: 'next-section',
  K: 'prev-section',
  P: 'prev-section',
  g: 'go-section',
  h: 'older-edition',
  ArrowLeft: 'older-edition',
  l: 'newer-edition',
  ArrowRight: 'newer-edition',
  E: 'everything',
  Escape: 'deselect',
  o: 'open',
  Enter: 'open',
  x: 'collapse',
  X: 'expand',
  c: 'comments',
  i: 'ask',
  s: 'save',
  u: 'read',
  A: 'read-all',
  B: 'read-above',
  Y: 'read-below',
  y: 'listen',
  r: 'reload',
  R: 'refresh',
  '/': 'search',
  F: 'fullscreen',
  U: 'masthead',
  S: 'theme',
  '?': 'help',
};

/**
 * The shortcut a key press asks for. Ctrl or Cmd with Enter opens in the
 * background, Shift with Enter or an up/down arrow means more (full text, the
 * next section); any other press with Ctrl, Alt or Cmd is the browser's
 * (Cmd-K, Ctrl-O), so none of them is taken.
 */
export function shortcutFor(press: KeyPress): Shortcut | null {
  if (press.key === 'Enter' && !press.altKey) {
    if (press.ctrlKey || press.metaKey) return 'open-background';
    if (press.shiftKey) return 'full-text';
  }
  if (press.altKey || press.ctrlKey || press.metaKey) return null;
  if (press.shiftKey && press.key === 'ArrowDown') return 'next-section';
  if (press.shiftKey && press.key === 'ArrowUp') return 'prev-section';
  return Object.hasOwn(KEYS, press.key) ? KEYS[press.key]! : null;
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

/** The last unread story, or -1 when every story is read (NewsBlur's `M`). */
export function lastUnread(read: readonly boolean[]): number {
  return read.lastIndexOf(false);
}

/**
 * The stories `A`, `B` and `Y` mark read: every one, the ones above the
 * focused story, or the ones below it (none above or below when nothing has
 * focus).
 */
export function storiesToMark(
  count: number,
  current: number,
  which: 'read-all' | 'read-above' | 'read-below',
): number[] {
  const all = Array.from({ length: count }, (_, i) => i);
  if (which === 'read-all') return all;
  if (current < 0) return [];
  return which === 'read-above'
    ? all.filter((i) => i < current)
    : all.filter((i) => i > current);
}

/** The sections whose names hold `query`, ignoring case (NewsBlur's `g`). */
export function matchSections(
  names: readonly string[],
  query: string,
): number[] {
  const q = query.trim().toLowerCase();
  return names.flatMap((name, i) =>
    name.toLowerCase().includes(q) ? [i] : [],
  );
}
