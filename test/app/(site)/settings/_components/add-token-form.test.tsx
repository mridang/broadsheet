import { describe, expect, it } from '@jest/globals';

import { tokenRequest } from '@/app/(site)/settings/_components/add-token-form';

/** A filled-in token form. */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe('tokenRequest', () => {
  it.each([
    [{ feed: 'saves' }, { scope: 'saves' }],
    [
      { feed: 'saves', tag: ' rust ' },
      { scope: 'saves', tag: 'rust' },
    ],
    [{ feed: 'edition', tag: 'ignored' }, { scope: 'edition' }],
    [{ feed: 'section:4' }, { scope: 'section', section_id: '4' }],
  ])('turns %j into %j', (fields, request) => {
    expect(tokenRequest(form(fields))).toEqual(request);
  });
});
