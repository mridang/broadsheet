import { describe, expect, it } from '@jest/globals';

import {
  fuzzyMatch,
  matchTier,
  normaliseTitle,
  overlap,
  relatedMatch,
  sameTitle,
  significantWords,
} from '@/domain/titles';

describe('normaliseTitle', () => {
  it('lowercases, spaces hyphens and slashes, and drops punctuation', () => {
    expect(normaliseTitle('  Self-Driving Cars/Trucks: Ready?! ')).toBe(
      'self driving cars trucks ready',
    );
  });

  it('is empty for no title', () => {
    expect(normaliseTitle(null)).toBe('');
  });
});

describe('significantWords', () => {
  it('drops stopwords, numbers and one-letter words, and stems plurals', () => {
    expect([...significantWords('The 3 cats of a city in 2026')]).toEqual([
      'cat',
      'city',
    ]);
  });

  it('keeps a double-s ending and short words whole', () => {
    expect([...significantWords('Glass bus')]).toEqual(['glass', 'bus']);
  });

  it('leaves out the words of the feed’s own name', () => {
    expect([...significantWords('Verge review: phones', 'The Verge')]).toEqual([
      'review',
      'phone',
    ]);
  });
});

describe('overlap', () => {
  it('counts shared words over the smaller set', () => {
    expect(overlap(new Set(['a', 'b']), new Set(['a', 'b', 'c', 'd']))).toEqual(
      { shared: 2, coefficient: 1 },
    );
  });

  it('is 0 for an empty set', () => {
    expect(overlap(new Set(), new Set(['a'])).coefficient).toBe(0);
  });
});

describe('sameTitle', () => {
  it('matches titles that normalise the same', () => {
    expect(sameTitle('Mars rover lands!', 'mars rover lands')).toBe(true);
  });

  it('refuses titles too short to tell', () => {
    expect(sameTitle('Update', 'update')).toBe(false);
  });
});

describe('fuzzyMatch', () => {
  const words = (t: string) => significantWords(t);

  it('matches titles sharing most of their words', () => {
    expect(
      fuzzyMatch(
        words('Apple unveils new iPhone camera battery design'),
        words('Apple unveils iPhone with new camera and battery'),
      ),
    ).toBe(true);
  });

  it('refuses titles with too few words', () => {
    expect(
      fuzzyMatch(words('Apple iPhone camera'), words('Apple iPhone camera')),
    ).toBe(false);
  });

  it('refuses titles sharing too little', () => {
    expect(
      fuzzyMatch(
        words('Apple unveils new iPhone camera battery design'),
        words('Google launches Pixel watch fitness tracker'),
      ),
    ).toBe(false);
  });
});

describe('relatedMatch', () => {
  it('needs four shared words', () => {
    expect(
      relatedMatch(
        new Set(['a', 'b', 'c', 'd', 'e']),
        new Set(['a', 'b', 'c', 'd', 'x', 'y']),
      ),
    ).toBe(true);
    expect(
      relatedMatch(new Set(['a', 'b', 'c']), new Set(['a', 'b', 'c'])),
    ).toBe(false);
  });
});

describe('matchTier', () => {
  it('is title for matching headlines', () => {
    expect(
      matchTier('Mars rover lands safely', 'Mars rover lands safely'),
    ).toBe('title');
  });

  it('is related for headlines only the meaning joins', () => {
    expect(matchTier('Mars rover lands', 'NASA probe touches down')).toBe(
      'related',
    );
  });
});
