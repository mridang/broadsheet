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
