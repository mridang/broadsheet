import { describe, expect, it } from '@jest/globals';

import { PROMPTS } from '@/domain/mcp/prompts';
import { TOOLS } from '@/domain/mcp/tools';

const prompt = (name: string) => PROMPTS.find((p) => p.name === name)!;
const toolNames = new Set(TOOLS.map((t) => t.name));

describe('PROMPTS', () => {
  it.each(PROMPTS.map((p) => [p.name, p] as const))(
    '%s names only tools the server has',
    (_name, p) => {
      const named = p.render({ topic: 't' }).match(/\b[a-z]+_[a-z_]+\b/g) ?? [];
      expect(
        named.filter(
          (n) => !toolNames.has(n) && n !== 'read_filter' && n !== 'feed_id',
        ),
      ).toEqual([]);
    },
  );

  it('puts the topic into research_topic', () => {
    expect(prompt('research_topic').render({ topic: 'fusion' })).toContain(
      '"fusion"',
    );
  });

  it('narrows triage to a feed when given one', () => {
    expect(prompt('triage_unread').render({ feed_id: '3' })).toContain(
      'feed_id 3',
    );
  });

  it('keeps to the interests given', () => {
    expect(
      prompt('discover_new_feeds').render({ interests: 'chess' }),
    ).toContain('chess');
  });
});
