import { describe, expect, it } from '@jest/globals';

import { collect } from '@/domain/mcp/tools/support';

describe('collect', () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ id: 250 - i }));
  const fetch = async (before: number | undefined, limit: number) =>
    rows
      .filter((r) => before === undefined || r.id < before)
      .slice(0, limit + 1);

  it('reads past batches until the page is full', async () => {
    const { items, next } = await collect(fetch, (r) => r.id % 50 === 0, 3);
    expect([items.map((r) => r.id), next]).toEqual([[250, 200, 150], 150]);
  });

  it('says nothing follows once the rows run out', async () => {
    const { next } = await collect(fetch, (r) => r.id === 1, 5);
    expect(next).toBeUndefined();
  });
});
