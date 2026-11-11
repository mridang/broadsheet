import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  briefingTitle,
  clockMinutes,
  clusterEntries,
  currentSlot,
  dueSlots,
  isTimeZone,
  localTime,
  preferredSlot,
  slotsFor,
  sqliteTime,
  writeScheduledBriefing,
} from '@/domain/briefings';
import { databaseFrom, type Database } from '@/domain/db/database';
import {
  DEFAULT_PREFERENCES,
  Repository,
  type Article,
} from '@/domain/repository';
import type { ScrapedItem } from '@/lib/scraping';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

describe('isTimeZone', () => {
  it('knows an IANA zone and refuses a made-up one', () => {
    expect(isTimeZone('Europe/Helsinki')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('localTime', () => {
  const at = new Date('2026-11-01T06:45:00Z');

  it('reads the clock and calendar of a zone', () => {
    expect(localTime(at, 'Asia/Tokyo')).toEqual({
      date: '2026-11-01',
      minutes: 15 * 60 + 45,
      weekday: 'sun',
    });
  });

  it('crosses midnight backwards', () => {
    expect(localTime(at, 'America/Los_Angeles')).toMatchObject({
      date: '2026-10-31',
      weekday: 'sat',
    });
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(localTime(at, 'Nowhere')).toMatchObject({ minutes: 6 * 60 + 45 });
  });
});

describe('clockMinutes', () => {
  it.each([
    ['00:00', 0],
    ['07:15', 435],
    ['23:59', 1439],
  ])('reads %s', (t, m) => {
    expect(clockMinutes(t)).toBe(m);
  });

  it.each(['24:00', '7:15', 'morning'])('refuses %s', (t) => {
    expect(clockMinutes(t)).toBeUndefined();
  });
});

describe('preferredSlot', () => {
  it.each([
    ['auto', 'morning', 510],
    ['morning', 'morning', 510],
    ['afternoon', 'afternoon', 750],
    ['evening', 'evening', 1020],
    ['06:10', 'custom', 370],
  ])('reads %s', (time, slot, at) => {
    expect(preferredSlot(time)).toEqual({ slot, at });
  });
});

describe('slotsFor', () => {
  const prefs = (over: Partial<typeof DEFAULT_PREFERENCES>) => ({
    ...DEFAULT_PREFERENCES,
    ...over,
  });
  const names = (list: { slot: string }[]) => list.map((s) => s.slot);

  it('has one slot a day for a daily briefing', () => {
    expect(names(slotsFor(prefs({ briefing_time: 'evening' }), 'mon'))).toEqual(
      ['evening'],
    );
  });

  it('adds the morning twice a day', () => {
    expect(
      names(
        slotsFor(
          prefs({
            briefing_frequency: 'twice_daily',
            briefing_time: 'evening',
          }),
          'mon',
        ),
      ),
    ).toEqual(['morning', 'evening']);
  });

  it('moves a morning preference to the afternoon twice a day', () => {
    expect(
      names(slotsFor(prefs({ briefing_frequency: 'twice_daily' }), 'mon')),
    ).toEqual(['morning', 'afternoon']);
  });

  it('has all three fixed slots three times a day', () => {
    expect(
      names(slotsFor(prefs({ briefing_frequency: 'thrice_daily' }), 'mon')),
    ).toEqual(['morning', 'afternoon', 'evening']);
  });

  it('comes weekly only on the chosen day', () => {
    const weekly = prefs({ briefing_frequency: 'weekly', briefing_day: 'fri' });
    expect(slotsFor(weekly, 'thu')).toEqual([]);
    expect(names(slotsFor(weekly, 'fri'))).toEqual(['morning']);
  });
});

describe('dueSlots', () => {
  const helsinki = { ...DEFAULT_PREFERENCES, timezone: 'Europe/Helsinki' };

  it('is due from five minutes before the slot on the reader’s clock', () => {
    // 08:25 in Helsinki (UTC+2 in November).
    expect(dueSlots(helsinki, new Date('2026-11-01T06:25:00Z'))).toEqual([
      { slot: 'morning', date: '2026-11-01' },
    ]);
  });

  it('is not due earlier, or long after', () => {
    expect(dueSlots(helsinki, new Date('2026-11-01T06:24:00Z'))).toEqual([]);
    expect(dueSlots(helsinki, new Date('2026-11-01T07:25:00Z'))).toEqual([]);
  });

  it('is never due when the reader turned briefings off', () => {
    expect(
      dueSlots(
        { ...helsinki, briefing_enabled: false },
        new Date('2026-11-01T06:30:00Z'),
      ),
    ).toEqual([]);
  });
});

describe('currentSlot', () => {
  it.each([
    ['2026-11-01T07:00:00Z', 'morning'],
    ['2026-11-01T12:30:00Z', 'afternoon'],
    ['2026-11-01T18:00:00Z', 'evening'],
  ])('at %s is %s', (at, slot) => {
    expect(currentSlot(new Date(at), 'UTC')).toBe(slot);
  });
});

describe('briefingTitle', () => {
  it('names the slot and the day', () => {
    expect(briefingTitle('morning', 510, 'daily', '2026-11-01')).toBe(
      'Morning Daily Briefing — Sunday, November 1, 2026',
    );
  });

  it('names a custom time by its part of the day, and a weekly one', () => {
    expect(briefingTitle('custom', 1100, 'weekly', '2026-11-01')).toBe(
      'Evening Weekly Briefing — Sunday, November 1, 2026',
    );
    expect(briefingTitle('custom', 800, 'daily', '2026-11-01')).toMatch(
      /^Afternoon/,
    );
  });
});

describe('sqliteTime', () => {
  it('writes a moment as SQLite does', () => {
    expect(sqliteTime(new Date('2026-11-01T06:05:09.123Z'))).toBe(
      '2026-11-01 06:05:09',
    );
  });
});

describe('clusterEntries', () => {
  const a = (id: number, sourceId: number, clusterId: number | null) =>
    ({
      id,
      source_id: sourceId,
      cluster_id: clusterId,
      source: `S${sourceId}`,
      url: 'u',
    }) as Article;

  it('counts the sources of a story and names the others', () => {
    const [first, , lone] = clusterEntries([
      a(1, 1, 9),
      a(2, 2, 9),
      a(3, 3, null),
    ]);
    expect(first).toMatchObject({ coverage: 2, also: ['S2'] });
    expect(lone).toMatchObject({ coverage: 1, also: [] });
  });
});

describe('writeScheduledBriefing', () => {
  let db: Database;
  let repo: Repository;
  let uid: number;
  let sourceId: number;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const item = (n: number, over: Partial<ScrapedItem> = {}): ScrapedItem => ({
    url: `https://x.test/${n}`,
    title: `Story ${n}`,
    source: 'X',
    favicon: '',
    summary: `About story ${n}`,
    image: '',
    published_at: '',
    points: n,
    ...over,
  });

  /** An env whose model answers with `response`. */
  const envWith = (response: unknown) => {
    const run = jest.fn<
      (model: string) => Promise<{ response: unknown; usage: object }>
    >(async () => ({
      response,
      usage: { total_tokens: 99 },
    }));
    return { run, env: { AI: { run } } as unknown as CloudflareEnv };
  };

  beforeEach(async () => {
    db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
    repo = new Repository(db);
    const user = await repo.upsertUser({ sub: 'g', email: 'a@b.c' });
    uid = user.id;
    sourceId = (await repo.addFeed(uid, 'https://x.test/rss', 'X'))!.source_id;
    await repo.writeEdition(sourceId, today, [item(1), item(2), item(3)]);
  });

  it('stores a complete briefing with its stories, sections and cost', async () => {
    const { env } = envWith('Note.');
    const { briefing, replaced } = await writeScheduledBriefing(
      db,
      env,
      uid,
      'morning',
      today,
      now,
    );
    expect(replaced).toBe(false);
    expect(briefing).toMatchObject({
      status: 'complete',
      summary: 'Note.',
      slot: 'morning',
      frequency: 'daily',
      tokens: 99,
    });
    expect(JSON.parse(briefing!.stories)).toHaveLength(3);
    expect(briefing!.title).toMatch(/^Morning Daily Briefing — /);
  });

  it('replaces the briefing of the same slot and day', async () => {
    await writeScheduledBriefing(
      db,
      envWith('One.').env,
      uid,
      'morning',
      today,
      now,
    );
    const again = await writeScheduledBriefing(
      db,
      envWith('Two.').env,
      uid,
      'morning',
      today,
      now,
    );
    expect(again.replaced).toBe(true);
    const briefings = await repo.listBriefings(uid, 10);
    expect(briefings.map((b) => b.summary)).toEqual(['Two.']);
  });

  it('stores a briefing the model could not write as failed', async () => {
    const { briefing } = await writeScheduledBriefing(
      db,
      envWith('').env,
      uid,
      'morning',
      today,
      now,
    );
    expect(briefing).toMatchObject({
      status: 'failed',
      error: 'Summary generation failed.',
    });
  });

  it('writes nothing with too few stories, without asking the model', async () => {
    await repo.writeEdition(sourceId, today, [item(1)]);
    const { run, env } = envWith('Note.');
    const result = await writeScheduledBriefing(
      db,
      env,
      uid,
      'morning',
      today,
      now,
    );
    expect(result.briefing).toBeUndefined();
    expect(result.skipped).toBe('Too few stories.');
    expect(run).not.toHaveBeenCalled();
  });

  it('takes one story twice a day', async () => {
    await repo.writeEdition(sourceId, today, [item(1)]);
    await repo.updatePreferences(uid, { briefing_frequency: 'twice_daily' });
    const { briefing } = await writeScheduledBriefing(
      db,
      envWith('Note.').env,
      uid,
      'morning',
      today,
      now,
    );
    expect(briefing?.status).toBe('complete');
  });

  it('leaves out stories an earlier briefing in the window covered', async () => {
    await writeScheduledBriefing(
      db,
      envWith('One.').env,
      uid,
      'morning',
      today,
      now,
    );
    const { run, env } = envWith('Two.');
    const result = await writeScheduledBriefing(
      db,
      env,
      uid,
      'evening',
      today,
      now,
    );
    expect(result.skipped).toBe('Too few stories.');
    expect(run).not.toHaveBeenCalled();
  });

  it('reads only the chosen section’s feeds', async () => {
    const section = await repo.addSection(uid, 'Tech');
    await repo.updatePreferences(uid, {
      briefing_sources: `section:${section.id}`,
    });
    const result = await writeScheduledBriefing(
      db,
      envWith('Note.').env,
      uid,
      'morning',
      today,
      now,
    );
    expect(result.skipped).toBe('Too few stories.');
  });

  it('adds keyword stories under the reader’s own section', async () => {
    // One source gives the personal sections three; the fourth is found
    // only by the reader's keywords.
    await repo.writeEdition(sourceId, today, [
      item(5),
      item(6),
      item(7),
      item(1, { title: 'Quantum chips arrive', points: 0 }),
    ]);
    await repo.updatePreferences(uid, { briefing_prompts: ['quantum'] });
    const { briefing } = await writeScheduledBriefing(
      db,
      envWith('Note.').env,
      uid,
      'morning',
      today,
      now,
    );
    expect(JSON.parse(briefing!.sections)).toContain('custom_1');
  });

  it('writes with the reader’s model', async () => {
    await repo.updatePreferences(uid, {
      briefing_model: '@cf/google/gemma-3-12b-it',
    });
    const { run, env } = envWith('Note.');
    await writeScheduledBriefing(db, env, uid, 'morning', today, now);
    expect(run.mock.calls[0]?.[0]).toBe('@cf/google/gemma-3-12b-it');
  });
});
