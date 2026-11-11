import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/** What the mocked parts of the app answer. */
const app = {
  bound: true,
  health: { ok: true, details: {} as Record<string, unknown> },
};

jest.unstable_mockModule('@/lib/core/runtime', () => ({
  isDatabaseBound: () => app.bound,
}));

jest.unstable_mockModule('@/lib/core/health', () => ({
  appHealth: async () => app.health,
}));

const { GET } = await import('@/app/health/route');

beforeEach(() => {
  app.bound = true;
  app.health = { ok: true, details: {} };
});

describe('GET /health', () => {
  it('answers 200 with ok, the database binding and a timestamp', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; db: boolean; ts: string };
    expect(body.ok).toBe(true);
    expect(body.db).toBe(true);
    expect(new Date(body.ts).toISOString()).toBe(body.ts);
  });

  it('is never cached', async () => {
    const reply = await GET();
    expect(reply.headers.get('cache-control')).toBe('no-store');
  });

  it('reports the database as missing, without failing', async () => {
    app.bound = false;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { db: boolean }).db).toBe(false);
  });

  it('adds what the app reports about itself to the body', async () => {
    app.health = { ok: true, details: { movies: 3 } };
    const reply = await GET();
    const body = (await reply.json()) as { movies: number };
    expect(body.movies).toBe(3);
  });

  it('answers 503 when the app says it is not healthy', async () => {
    app.health = { ok: false, details: { stale: true } };
    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; stale: boolean };
    expect(body).toMatchObject({ ok: false, stale: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
