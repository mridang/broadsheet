import { describe, expect, it } from '@jest/globals';

import { ReadingPreferences } from '@/app/(site)/settings/_components/reading-preferences';
import { html } from '../../../../components/render';

describe('ReadingPreferences', () => {
  it('selects the reader’s level', () => {
    expect(
      html(
        <ReadingPreferences
          intelligence="focus"
          markReadOnOpen
          autoMarkReadDays={0}
        />,
      ),
    ).toMatch(/<option value="focus" selected="">/);
  });

  it('offers every level', () => {
    const out = html(
      <ReadingPreferences
        intelligence="unread"
        markReadOnOpen
        autoMarkReadDays={0}
      />,
    );
    ['focus', 'unread', 'all'].forEach((level) =>
      expect(out).toContain(`value="${level}"`),
    );
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
      />,
    );
    expect(/type="checkbox"[^>]*checked/.test(out)).toBe(ticked);
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
        />,
      ),
    ).toMatch(/type="number"[^>]*value="14"/);
  });
});
