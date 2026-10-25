import { describe, expect, it } from '@jest/globals';

import { ok, created, noContent, page } from '@/lib/core/api';

describe('results', () => {
  it('ok() carries the body, and optional headers and location', () => {
    expect(ok({ a: 1 })).toEqual({
      body: { a: 1 },
      headers: undefined,
      location: undefined,
    });
    expect(
      ok(
        { a: 1 },
        { headers: { 'Cache-Control': 'no-store' }, location: '/x' },
      ),
    ).toEqual({
      body: { a: 1 },
      headers: { 'Cache-Control': 'no-store' },
      location: '/x',
    });
  });

  it('created() is a 201 with the body and a location', () => {
    expect(created({ id: 7 }, '/api/things/7')).toEqual({
      status: 201,
      body: { id: 7 },
      location: '/api/things/7',
      headers: undefined,
    });
  });

  it('noContent() is a 204 with no body', () => {
    expect(noContent()).toEqual({ status: 204, headers: undefined });
    expect(noContent({ 'X-Done': 'yes' })).toEqual({
      status: 204,
      headers: { 'X-Done': 'yes' },
    });
  });

  it('page() carries the items and the optional next position', () => {
    const next = { key: 'k', id: '1' };
    expect(page([1, 2], next)).toEqual({
      page: { items: [1, 2], next },
      headers: undefined,
    });
    expect(page([1])).toEqual({
      page: { items: [1], next: undefined },
      headers: undefined,
    });
  });
});
