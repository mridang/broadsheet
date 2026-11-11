import { describe, expect, it } from '@jest/globals';

import type { NotificationRule } from '@/domain/notifications';
import { matchesRule, regexProblem, type RuledStory } from '@/domain/rules';

const story: RuledStory = {
  feed_id: 1,
  section_id: 5,
  title: 'Rust 2.0 released',
  url: 'https://blog.example/rust-2',
  summary: 'The compiler is faster.',
  body_text: 'Memory safety without garbage collection.',
  author: 'Ferris',
  tags: ['release'],
};

/** A rule matching every feed by title, with what a case changes. */
const rule = (over: Partial<NotificationRule>): NotificationRule => ({
  id: 1,
  kind: 'title',
  value: 'rust',
  is_regex: false,
  scope: 'all',
  channels: ['web'],
  created_at: null,
  ...over,
});

describe('regexProblem', () => {
  it.each([String.raw`^rust \d`, 'rust|go', '[a-z]+ released'])(
    'accepts %s',
    (p) => {
      expect(regexProblem(p)).toBeUndefined();
    },
  );

  it.each([
    ['(a+)+', 'a repeated group may not itself repeat'],
    ['(x*)*y', 'a repeated group may not itself repeat'],
    [String.raw`(a)\1`, 'back-references are not allowed'],
    ['(', 'not a valid regular expression'],
    ['a'.repeat(201), 'too long'],
  ])('refuses %s', (p, problem) => {
    expect(regexProblem(p)).toBe(problem);
  });
});

describe('matchesRule', () => {
  it.each([
    [{ kind: 'title', value: 'RUST' }, true],
    [{ kind: 'title', value: 'python' }, false],
    [{ kind: 'title', value: String.raw`^rust \d`, is_regex: true }, true],
    [{ kind: 'text', value: 'garbage collection' }, true],
    [{ kind: 'text', value: 'faster' }, true],
    [{ kind: 'url', value: 'blog.example' }, true],
    [{ kind: 'url', value: String.raw`rust-\d$`, is_regex: true }, true],
    [{ kind: 'author', value: 'Ferris' }, true],
    [{ kind: 'author', value: 'ferris' }, false],
    [{ kind: 'author', value: '^fer', is_regex: true }, true],
    [{ kind: 'tag', value: 'release' }, true],
    [{ kind: 'tag', value: 'beta' }, false],
    [{ kind: 'prompt', value: 'Rust releases' }, false],
    [{ kind: 'title', value: '(a+)+', is_regex: true }, false],
  ] as const)('%j matches: %s', (over, yes) => {
    expect(matchesRule(rule(over), story)).toBe(yes);
  });

  it.each([
    [{ scope: 'feed', feed_id: 1 }, true],
    [{ scope: 'feed', feed_id: 2 }, false],
    [{ scope: 'section', section_id: 5 }, true],
    [{ scope: 'section', section_id: 6 }, false],
  ] as const)('in scope %j matches: %s', (over, yes) => {
    expect(matchesRule(rule(over), story)).toBe(yes);
  });

  it('matches nothing on a story without the field', () => {
    const bare = { ...story, title: null, author: null };
    delete bare.tags;
    expect(matchesRule(rule({ kind: 'title' }), bare)).toBe(false);
    expect(matchesRule(rule({ kind: 'author', value: 'Ferris' }), bare)).toBe(
      false,
    );
    expect(matchesRule(rule({ kind: 'tag', value: 'release' }), bare)).toBe(
      false,
    );
  });
});
