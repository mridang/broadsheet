import { describe, expect, it } from '@jest/globals';

import {
  SHORTCUTS,
  focusedStory,
  isTyping,
  nextUnread,
  sectionStep,
  shortcutFor,
  step,
} from '@/app/(site)/_components/shortcuts';

const press = (key: string, mods: Partial<Record<string, boolean>> = {}) => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe('shortcutFor', () => {
  it.each([
    ['j', 'next'],
    ['k', 'prev'],
    ['o', 'open'],
    ['Enter', 'open'],
    ['s', 'save'],
    ['?', 'help'],
  ])('maps %s to %s', (key, shortcut) => {
    expect(shortcutFor(press(key))).toBe(shortcut);
  });

  it('leaves other keys to the browser', () => {
    expect(shortcutFor(press('x'))).toBeNull();
  });

  it.each(['altKey', 'ctrlKey', 'metaKey'])(
    'leaves a press with %s to the browser',
    (mod) => {
      expect(shortcutFor(press('k', { [mod]: true }))).toBeNull();
    },
  );
});

describe('isTyping', () => {
  it.each(['INPUT', 'textarea', 'SELECT'])('is true in a %s', (tagName) => {
    expect(isTyping({ tagName })).toBe(true);
  });

  it('is true in an editable element', () => {
    expect(isTyping({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('is false on a link or the page itself', () => {
    expect(isTyping({ tagName: 'A' })).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe('step', () => {
  it('starts at the first story going forward and the last going back', () => {
    expect(step(-1, 5, 'next')).toBe(0);
    expect(step(-1, 5, 'prev')).toBe(4);
  });

  it('moves one story at a time', () => {
    expect(step(2, 5, 'next')).toBe(3);
    expect(step(2, 5, 'prev')).toBe(1);
  });

  it('stops at either end instead of wrapping', () => {
    expect(step(4, 5, 'next')).toBe(4);
    expect(step(0, 5, 'prev')).toBe(0);
  });

  it('has nowhere to go with no stories', () => {
    expect(step(-1, 0, 'next')).toBe(-1);
  });
});

describe('SHORTCUTS', () => {
  it('lists a line for every shortcut the page answers to', () => {
    expect(SHORTCUTS).toHaveLength(14);
    expect(SHORTCUTS.map(([keys]) => keys)).toContain('n');
  });
});

describe('nextUnread', () => {
  it('skips read stories after the focused one', () => {
    expect(nextUnread([false, true, true, false], 0)).toBe(3);
  });

  it('starts from the top with nothing focused', () => {
    expect(nextUnread([true, false], -1)).toBe(1);
  });

  it('is -1 when every later story is read', () => {
    expect(nextUnread([false, true], 0)).toBe(-1);
  });
});

describe('sectionStep', () => {
  const sections = [0, 0, 1, 1, 2];

  it('moves to the first story of the next or previous section', () => {
    expect(sectionStep(sections, 1, 'next')).toBe(2);
    expect(sectionStep(sections, 4, 'prev')).toBe(2);
  });

  it('starts at the first or last section with nothing focused', () => {
    expect(sectionStep(sections, -1, 'next')).toBe(0);
    expect(sectionStep(sections, -1, 'prev')).toBe(4);
  });

  it('is -1 past either end or with no stories', () => {
    expect(sectionStep(sections, 4, 'next')).toBe(-1);
    expect(sectionStep(sections, 0, 'prev')).toBe(-1);
    expect(sectionStep([], -1, 'next')).toBe(-1);
  });
});

describe('focusedStory', () => {
  const button = { name: 'listen' };
  const cards = [
    { contains: () => false },
    { contains: (node: unknown) => node === button },
  ];

  it('finds the story whose card holds the focused element', () => {
    expect(focusedStory(cards, button)).toBe(1);
  });

  it('is -1 when nothing in a story has focus', () => {
    expect(focusedStory(cards, { name: 'elsewhere' })).toBe(-1);
    expect(focusedStory(cards, null)).toBe(-1);
  });
});
