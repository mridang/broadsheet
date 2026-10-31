import { describe, expect, it } from '@jest/globals';

import { TOPICS, findTopic } from '@/domain/topics';

describe('TOPICS', () => {
  it('has unique ids and valid starter feeds', () => {
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length);
    for (const topic of TOPICS) {
      expect(topic.id).toMatch(/^[a-z]+$/);
      expect(topic.feeds.length).toBeGreaterThan(0);
      for (const feed of topic.feeds) {
        expect(new URL(feed.url).protocol).toBe('https:');
      }
    }
  });
});

describe('findTopic', () => {
  it('finds a topic by id', () => {
    expect(findTopic('technology')?.name).toBe('Technology');
  });
  it('is undefined for an unknown id', () => {
    expect(findTopic('nope')).toBeUndefined();
  });
});
