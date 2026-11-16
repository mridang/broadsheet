import { describe, expect, it } from '@jest/globals';

import { ReadingPreferences } from '@/app/(site)/settings/_components/reading-preferences';
import { html } from '../../../../components/render';

const SELECTS_THE_READER_S_LEVEL_PATTERN = /<option value="focus" selected="">/;
const READING_PREFERENCES_PATTERN = /type="checkbox"[^>]*checked=""/;
const SHOWS_THE_READER_S_DAYS_PATTERN = /type="number"[^>]*value="14"/;
const READING_PREFERENCES_MARK_READ_ON_SCROLL_PATTERN =
  /type="checkbox"[^>]*checked=""/g;

describe('ReadingPreferences', () => {
  it('selects the reader’s level', () => {
    expect(
      html(
        <ReadingPreferences
          intelligence="focus"
          markReadOnOpen
          autoMarkReadDays={0}
          markReadOnScroll={false}
        />,
      ),
    ).toMatch(SELECTS_THE_READER_S_LEVEL_PATTERN);
  });

  it('offers every level', () => {
    const out = html(
      <ReadingPreferences
        intelligence="unread"
        markReadOnOpen
        autoMarkReadDays={0}
        markReadOnScroll={false}
      />,
    );
    for (const level of ['focus', 'unread', 'all'])
      expect(out).toContain(`value="${level}"`);
  });

  it.each([
    [true, true],
    [false, false],
  ])('ticks mark-read-on-open when it is %s', (on, ticked) => {
    const out = html(
      <ReadingPreferences
        intelligence="unread"
        markReadOnOpen={on}
        autoMarkReadDays={0}
        markReadOnScroll={false}
      />,
    );
    expect(READING_PREFERENCES_PATTERN.test(out)).toBe(ticked);
  });
});

describe('ReadingPreferences auto-mark-read days', () => {
  it('shows the reader’s days', () => {
    expect(
      html(
        <ReadingPreferences
          intelligence="unread"
          markReadOnOpen
          autoMarkReadDays={14}
          markReadOnScroll={false}
        />,
      ),
    ).toMatch(SHOWS_THE_READER_S_DAYS_PATTERN);
  });
});

describe('ReadingPreferences mark-read-on-scroll', () => {
  it.each([
    [true, 1],
    [false, 0],
  ])('ticks scrolling past when it is %s', (on, ticked) => {
    const out = html(
      <ReadingPreferences
        intelligence="unread"
        markReadOnOpen={false}
        autoMarkReadDays={0}
        markReadOnScroll={on}
      />,
    );
    expect(
      out.match(READING_PREFERENCES_MARK_READ_ON_SCROLL_PATTERN)?.length ?? 0,
    ).toBe(ticked);
  });
});
