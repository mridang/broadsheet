import { describe, expect, it } from '@jest/globals';

import {
  parsePreferenceChanges,
  preferencesResource,
  sourceSection,
} from '@/domain/api/preference-resource';
import { DEFAULT_PREFERENCES } from '@/domain/repository';

describe('preferencesResource', () => {
  it('groups the briefing preferences', () => {
    expect(preferencesResource(DEFAULT_PREFERENCES)).toMatchObject({
      story_clustering: true,
      cluster_mode: 'related',
      cluster_mark_read: false,
      cluster_preview_style: 'single_line',
      timezone: 'UTC',
      briefing: {
        enabled: true,
        story_count: 5,
        length: 'medium',
        style: 'bullets',
        read_filter: 'unread',
        frequency: 'daily',
        time: 'morning',
        day: 'sun',
        sources: 'all',
        include_read: false,
        prompts: [],
      },
      intelligence: 'unread',
      mark_read_on_open: true,
      auto_mark_read_days: 0,
      mark_read_on_scroll: false,
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
      { briefing: { colour: 'red' } },
      'briefing.colour: not a briefing preference.',
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
      'briefing.length: must be one of short, medium, detailed.',
    ],
    [
      { briefing: { style: 'poem' } },
      'briefing.style: must be one of editorial, bullets, headlines.',
    ],
    [
      { briefing: { read_filter: 'all' } },
      'briefing.read_filter: must be one of unread, focus.',
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

describe('parsePreferenceChanges for the schedule and sections', () => {
  it('accepts every briefing member', () => {
    const out = parsePreferenceChanges({
      cluster_preview_style: 'expanded',
      timezone: 'Europe/Helsinki',
      briefing: {
        frequency: 'twice_daily',
        time: '07:15',
        day: 'mon',
        sources: 'section:3',
        include_read: true,
        model: '@cf/google/gemma-3-12b-it',
        sections: { long_read: false },
        section_order: ['long_read', 'top_stories'],
        prompts: [' rust ', 'space'],
      },
    });
    expect(out).toEqual({
      ok: true,
      changes: {
        cluster_preview_style: 'expanded',
        timezone: 'Europe/Helsinki',
        briefing_frequency: 'twice_daily',
        briefing_time: '07:15',
        briefing_day: 'mon',
        briefing_sources: 'section:3',
        briefing_include_read: true,
        briefing_model: '@cf/google/gemma-3-12b-it',
        briefing_sections: { long_read: false },
        briefing_section_order: ['long_read', 'top_stories'],
        briefing_prompts: ['rust', 'space'],
      },
    });
  });

  it('clears the model with null', () => {
    expect(parsePreferenceChanges({ briefing: { model: null } })).toEqual({
      ok: true,
      changes: { briefing_model: null },
    });
  });

  it.each(['auto', 'morning', 'afternoon', 'evening', '00:00', '23:59'])(
    'accepts the time %s',
    (time) => {
      expect(parsePreferenceChanges({ briefing: { time } }).ok).toBe(true);
    },
  );

  it.each([
    [
      { cluster_preview_style: 'big' },
      'cluster_preview_style: must be single_line or expanded.',
    ],
    [{ timezone: 'Mars/Olympus' }, 'timezone: must be an IANA time zone.'],
    [
      { briefing: { frequency: 'hourly' } },
      'briefing.frequency: must be one of daily, twice_daily, thrice_daily, weekly.',
    ],
    [
      { briefing: { time: '24:00' } },
      'briefing.time: must be auto, morning, afternoon, evening or HH:MM.',
    ],
    [
      { briefing: { day: 'monday' } },
      'briefing.day: must be one of sun, mon, tue, wed, thu, fri, sat.',
    ],
    [
      { briefing: { sources: 'section:0' } },
      'briefing.sources: must be all or section:{id}.',
    ],
    [
      { briefing: { include_read: 1 } },
      'briefing.include_read: must be true or false.',
    ],
    [
      { briefing: { sections: { nope: true } } },
      'briefing.sections: must map section keys to true or false.',
    ],
    [
      { briefing: { sections: { long_read: 'no' } } },
      'briefing.sections: must map section keys to true or false.',
    ],
    [
      { briefing: { section_order: ['long_read', 'long_read'] } },
      'briefing.section_order: must list section keys, each once.',
    ],
    [
      { briefing: { prompts: ['a', 'b', 'c', 'd', 'e', 'f'] } },
      'briefing.prompts: must be at most 5 texts of at most 500 characters.',
    ],
    [
      { briefing: { prompts: ['x'.repeat(501)] } },
      'briefing.prompts: must be at most 5 texts of at most 500 characters.',
    ],
  ])('refuses %j', (body, error) => {
    const out = parsePreferenceChanges(body);
    expect(out.ok ? [] : out.errors).toEqual([error]);
  });

  it('refuses a model we do not offer', () => {
    const out = parsePreferenceChanges({ briefing: { model: '@cf/x/y' } });
    expect(out.ok ? [] : out.errors[0]).toMatch(
      /^briefing\.model: must be null or one of /,
    );
  });
});

describe('sourceSection', () => {
  it('reads the section of a section source', () => {
    expect(sourceSection('section:12')).toBe(12);
    expect(sourceSection('all')).toBeUndefined();
  });
});

describe('preferencesResource order', () => {
  it('lists every section, the person’s order first', () => {
    const out = preferencesResource({
      ...DEFAULT_PREFERENCES,
      briefing_section_order: ['long_read'],
      briefing_sections: { long_read: false },
      briefing_model: '@cf/google/gemma-3-12b-it',
    });
    expect(out.briefing.section_order[0]).toBe('long_read');
    expect(out.briefing.section_order).toHaveLength(15);
    expect(out.briefing.sections.long_read).toBe(false);
    expect(out.briefing.sections.top_stories).toBe(true);
    expect(out.briefing.model).toBe('@cf/google/gemma-3-12b-it');
  });
});

describe('mark-read-on-scroll', () => {
  it('takes a change', () => {
    expect(parsePreferenceChanges({ mark_read_on_scroll: true })).toEqual({
      ok: true,
      changes: { mark_read_on_scroll: true },
    });
  });

  it('refuses a value that is not true or false', () => {
    const out = parsePreferenceChanges({ mark_read_on_scroll: 1 });
    expect(out.ok ? [] : out.errors).toEqual([
      'mark_read_on_scroll: must be true or false.',
    ]);
  });
});
