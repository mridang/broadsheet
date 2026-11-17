import { describe, expect, it } from '@jest/globals';

import {
  WriteBriefing,
  briefingPage,
  failureOf,
} from '@/app/(site)/briefings/_components/write-briefing';
import { html } from '../../../../components/render';

const IS_A_PLAIN_BUTTON_PATTERN =
  /<button type="button"[^>]*>Write a briefing now<\/button>/u;
const IS_A_PLAIN_BUTTON_PATTERN_2 = /<output aria-live="polite"/u;
const SAYS_TOO_FEW_STORIES_PATTERN = /Too few new stories/u;
const ASKS_TO_WAIT_FOR_PATTERN = /Try again in a minute/u;

describe('WriteBriefing', () => {
  const out = html(<WriteBriefing />);

  it('is a plain button, with a status line that is read out', () => {
    expect(out).toMatch(IS_A_PLAIN_BUTTON_PATTERN);
    expect(out).toMatch(IS_A_PLAIN_BUTTON_PATTERN_2);
  });

  it('shows no progress before it is pressed', () => {
    expect(out).not.toContain('<progress');
  });
});

describe('briefingPage', () => {
  it('turns the briefing’s Location into its page', () => {
    expect(briefingPage('/api/editions/self/briefings/42')).toBe(
      '/briefings/42',
    );
  });

  it('is undefined with no Location', () => {
    expect(briefingPage(null)).toBeUndefined();
  });
});

describe('failureOf', () => {
  const problem = (status: number, body: unknown) =>
    Response.json(body, {
      status,
      headers: { 'Content-Type': 'application/problem+json' },
    });

  it('says too few stories qualify for a 404', async () => {
    expect(await failureOf(problem(404, {}))).toMatch(
      SAYS_TOO_FEW_STORIES_PATTERN,
    );
  });

  it('asks to wait for a 429', async () => {
    expect(await failureOf(problem(429, {}))).toMatch(ASKS_TO_WAIT_FOR_PATTERN);
  });

  it('shows the problem’s detail otherwise', async () => {
    expect(
      await failureOf(
        problem(502, { title: 'Bad gateway', detail: 'AI down' }),
      ),
    ).toBe('AI down');
  });

  it('falls back when the body is not JSON', async () => {
    expect(await failureOf(new Response('x', { status: 500 }))).toBe(
      'The briefing could not be written.',
    );
  });
});
