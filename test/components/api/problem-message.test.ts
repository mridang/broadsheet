import { describe, expect, it } from '@jest/globals';

import {
  ProblemError,
  problemError,
  problemMessage,
  problemText,
} from '@/components/api/problem-message';

const refusal = (body: unknown, status = 409) =>
  new Response(JSON.stringify(body), { status });

describe('problemMessage', () => {
  it('prefers the detail, then the title, and adds field messages', async () => {
    expect(await problemMessage(refusal({ title: 'T', detail: 'D' }))).toBe(
      'D',
    );
    expect(await problemMessage(refusal({ title: 'T' }))).toBe('T');
    expect(
      await problemMessage(refusal({ detail: 'Bad.', errors: ['a.', 'b.'] })),
    ).toBe('Bad. a. b.');
  });

  it('falls back to the status for a body that is not a problem', async () => {
    expect(await problemMessage(new Response('<html>', { status: 502 }))).toBe(
      'Request failed (502).',
    );
  });
});

describe('problemText', () => {
  it('shows the API’s own words when it refused', async () => {
    const error = await problemError(
      refusal({ detail: 'Connect Drive first.' }),
    );
    expect(error).toBeInstanceOf(ProblemError);
    expect(problemText(error, 'Could not save.')).toBe('Connect Drive first.');
  });

  it('shows the fallback for anything else, such as a network failure', () => {
    expect(
      problemText(new TypeError('Failed to fetch'), 'Could not save.'),
    ).toBe('Could not save.');
    expect(problemText('boom', 'Could not save.')).toBe('Could not save.');
  });
});
