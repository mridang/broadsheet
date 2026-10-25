import { afterEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, getDatabase } from '@/domain/db/database';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../lib/core/db/sqlite-d1';

describe('databaseFrom', () => {
  it('wraps a raw binding in the app-typed Drizzle client', () => {
    const { d1 } = sqliteD1();
    expect(databaseFrom(d1).$client).toBe(d1);
  });
});

describe('getDatabase', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("wraps the request context's binding in a Drizzle client", () => {
    const { d1 } = sqliteD1();
    restore = installCloudflareContext(d1);
    expect(getDatabase().$client).toBe(d1);
  });
});
