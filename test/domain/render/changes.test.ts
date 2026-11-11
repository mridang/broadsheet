import { describe, expect, it } from '@jest/globals';

import {
  MAX_WORDS,
  hasChanges,
  plainText,
  storyChanges,
} from '@/domain/render/changes';

describe('plainText', () => {
  it('takes out markup, reads entities and folds spaces', () => {
    expect(
      plainText('<p>Tom &amp; Jerry</p><script>x()</script>\n<b>run</b>'),
    ).toBe('Tom & Jerry run');
  });
});

describe('hasChanges', () => {
  it('is true only when the first text differs from the current one', () => {
    expect(hasChanges('<p>Old</p>', 'New')).toBe(true);
    expect(hasChanges('<p>Same</p>', 'Same ')).toBe(false);
    expect(hasChanges(null, 'New')).toBe(false);
  });
});

describe('storyChanges', () => {
  it('keeps the shared words and marks what was added and taken out', () => {
    expect(
      storyChanges(
        'The minister will resign today',
        'The minister resigned today',
      ),
    ).toEqual([
      { op: 'same', text: 'The minister' },
      { op: 'del', text: 'will resign' },
      { op: 'ins', text: 'resigned' },
      { op: 'same', text: 'today' },
    ]);
  });

  it('marks words added at the end', () => {
    expect(storyChanges('Fire', 'Fire contained')).toEqual([
      { op: 'same', text: 'Fire' },
      { op: 'ins', text: 'contained' },
    ]);
  });

  it('shows the whole text replaced past the word limit', () => {
    const long = 'w '.repeat(MAX_WORDS + 1);
    expect(storyChanges(long, 'short').map((c) => c.op)).toEqual([
      'del',
      'ins',
    ]);
  });
});

describe('plainText tag stripping', () => {
  const TAG = new RegExp(['<[^>]', '*>'].join(''), 'g');

  it.each([
    'a <> b',
    'a <b>c</b> d',
    'a < b <i>c</i>',
    '<<a>b',
    'x<y',
    'x>y<z>',
    '<>',
    '',
  ])('strips tags in %j as the original pattern did', (text) => {
    const expected = text.replaceAll(TAG, '').replaceAll(/\s+/g, ' ').trim();
    expect(plainText(text)).toBe(expected);
  });

  it('stays fast on a long run of "<" with no closing bracket', () => {
    const started = Date.now();
    expect(plainText(`a ${'<'.repeat(100_000)}`)).toBe(
      `a ${'<'.repeat(100_000)}`,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
