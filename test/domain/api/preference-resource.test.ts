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
      intelligence: 'unread',
      mark_read_on_open: true,
      auto_mark_read_days: 0,
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

describe('reading preferences', () => {
  it('shows the intelligence level, mark-on-open and auto-read days', () => {
    expect(preferencesResource(DEFAULT_PREFERENCES)).toMatchObject({
      intelligence: 'unread',
      mark_read_on_open: true,
      auto_mark_read_days: 0,
    });
  });

  it('takes a change to each', () => {
    expect(
      parsePreferenceChanges({
        intelligence: 'focus',
        mark_read_on_open: false,
        auto_mark_read_days: 14,
      }),
    ).toEqual({
      ok: true,
      changes: {
        intelligence: 'focus',
        mark_read_on_open: false,
        auto_mark_read_days: 14,
      },
    });
  });

  it.each([
    [
      { intelligence: 'hidden' },
      'intelligence: must be one of focus, unread, all.',
    ],
    [{ mark_read_on_open: 'yes' }, 'mark_read_on_open: must be true or false.'],
    [
      { auto_mark_read_days: 366 },
      'auto_mark_read_days: must be a whole number from 0 to 365.',
    ],
    [
      { auto_mark_read_days: 1.5 },
      'auto_mark_read_days: must be a whole number from 0 to 365.',
    ],
  ])('refuses %j', (body, error) => {
    const out = parsePreferenceChanges(body);
    expect(out.ok ? [] : out.errors).toEqual([error]);
  });
});
