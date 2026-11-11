import { describe, expect, it } from '@jest/globals';

import { newestPage, pageRequest } from '@/domain/api/paging';
import { encodeCursor } from '@/lib/core/api';

const request = (query: string) => new Request(`https://app.test/x${query}`);

describe('pageRequest', () => {
  it('defaults to the first page of 20', () => {
    expect(pageRequest(request(''))).toEqual({ after: undefined, limit: 20 });
  });

  it('reads the limit and the cursor', () => {
    const cursor = encodeCursor({ key: 'k', id: '1' });
    expect(pageRequest(request(`?limit=5&cursor=${cursor}`))).toEqual({
      after: { key: 'k', id: '1' },
      limit: 5,
    });
  });

  it.each(['?limit=0', '?cursor=nope'])('throws a 400 for %s', (query) => {
    let thrown: unknown;
    try {
      pageRequest(request(query));
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Response).status).toBe(400);
  });
});

describe('newestPage', () => {
  const rows = [
    { key: 'b', id: '3' },
    { key: 'b', id: '2' },
    { key: 'a', id: '9' },
  ];

  it('pages newest first, breaking ties by the higher id', () => {
    const first = newestPage(rows, (r) => r, { after: undefined, limit: 2 });
    expect(first.items).toEqual(rows.slice(0, 2));
    const second = newestPage(rows, (r) => r, { after: first.next, limit: 2 });
    expect(second).toEqual({ items: [rows[2]] });
  });
});
