import { describe, expect, it } from '@jest/globals';

import {
  parsePreferenceChanges,
  preferencesResource,
} from '@/domain/api/preference-resource';
import { DEFAULT_PREFERENCES } from '@/domain/repository';

describe('preferencesResource', () => {
  it('groups the briefing preferences', () => {
    expect(preferencesResource(DEFAULT_PREFERENCES)).toEqual({
      story_clustering: true,
      cluster_mode: 'related',
      cluster_mark_read: false,
      briefing: {
        enabled: true,
        story_count: 5,
        length: 'medium',
        style: 'bullets',
        read_filter: 'unread',
      },
    });
  });
});

describe('parsePreferenceChanges', () => {
  it('accepts every member', () => {
    expect(
      parsePreferenceChanges({
        story_clustering: false,
        cluster_mode: 'title',
        cluster_mark_read: true,
        briefing: {
          enabled: false,
          story_count: 10,
          length: 'detailed',
          style: 'editorial',
          read_filter: 'focus',
        },
      }),
    ).toEqual({
      ok: true,
      changes: {
        story_clustering: false,
        cluster_mode: 'title',
        cluster_mark_read: true,
        briefing_enabled: false,
        briefing_story_count: 10,
        briefing_length: 'detailed',
        briefing_style: 'editorial',
        briefing_read_filter: 'focus',
      },
    });
  });

  it('accepts an empty change', () => {
    expect(parsePreferenceChanges({})).toEqual({ ok: true, changes: {} });
  });

  it.each([
    [{ colour: 'red' }, 'colour: not a preference.'],
    [{ story_clustering: 'yes' }, 'story_clustering: must be true or false.'],
    [{ cluster_mark_read: 1 }, 'cluster_mark_read: must be true or false.'],
    [{ cluster_mode: 'meaning' }, 'cluster_mode: must be title or related.'],
    [{ briefing: [] }, 'briefing: must be an object.'],
    [{ briefing: null }, 'briefing: must be an object.'],
    [
      { briefing: { time: '08:00' } },
      'briefing.time: not a briefing preference.',
    ],
    [
      { briefing: { enabled: 'no' } },
      'briefing.enabled: must be true or false.',
    ],
    [
      { briefing: { story_count: 7 } },
      'briefing.story_count: must be one of 5, 10, 15, 20, 25.',
    ],
    [
      { briefing: { length: 'long' } },
      'briefing.length: must be short, medium or detailed.',
    ],
    [
      { briefing: { style: 'poem' } },
      'briefing.style: must be editorial, bullets or headlines.',
    ],
    [
      { briefing: { read_filter: 'all' } },
      'briefing.read_filter: must be unread or focus.',
    ],
  ])('refuses %j', (body, error) => {
    const out = parsePreferenceChanges(body);
    expect(out.ok ? [] : out.errors).toEqual([error]);
  });
});
