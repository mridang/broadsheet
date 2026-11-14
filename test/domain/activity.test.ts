import { describe, expect, it } from '@jest/globals';

import { noteActivity } from '@/domain/activity';
import { databaseFrom } from '@/domain/db/client';
import { NotificationRepository } from '@/domain/notifications';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

describe('noteActivity', () => {
  it('notes the day once per isolate, and again the next day', async () => {
    const db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
    const day = new Date('2026-10-02T09:00:00Z');
    expect(await noteActivity(db, 41, day)).toBe(true);
    expect(await noteActivity(db, 41, new Date('2026-10-02T18:00:00Z'))).toBe(
      false,
    );
    expect(await noteActivity(db, 41, new Date('2026-10-03T01:00:00Z'))).toBe(
      true,
    );
    expect(await new NotificationRepository(db).lastSeen(41)).toBe(
      '2026-10-03',
    );
  });
});
