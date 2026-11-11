import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  addEdition,
  editEdition,
  removeEdition,
} from '@/app/(site)/editions/_components/edition-requests';
import { ProblemError } from '@/components/api/problem-message';

afterEach(() => {
  jest.restoreAllMocks();
});

const answer = (response: Response) =>
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);

const edition = {
  name: 'Weekend',
  section_ids: ['2'],
  query: null,
  tag: 'long',
};

describe('addEdition', () => {
  it('posts the edition as JSON to the editions collection', async () => {
    const spy = answer(new Response('{}', { status: 201 }));
    await addEdition(edition);
    expect(spy).toHaveBeenCalledWith('/api/editions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edition),
    });
  });

  it('throws the server’s own words when it refuses', async () => {
    answer(
      Response.json(
        { title: 'No', detail: 'Not valid.' },
        {
          status: 400,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      ),
    );
    await expect(addEdition(edition)).rejects.toThrow(
      new ProblemError('Not valid.'),
    );
  });
});

describe('editEdition', () => {
  it('patches the edition’s own address', async () => {
    const spy = answer(new Response('{}', { status: 200 }));
    await editEdition(4, edition);
    expect(spy).toHaveBeenCalledWith('/api/editions/4', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edition),
    });
  });
});

describe('removeEdition', () => {
  it('deletes the edition’s own address', async () => {
    const spy = answer(new Response(null, { status: 204 }));
    await removeEdition(4);
    expect(spy).toHaveBeenCalledWith('/api/editions/4', { method: 'DELETE' });
  });
});
