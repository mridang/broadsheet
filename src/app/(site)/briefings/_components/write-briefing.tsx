'use client';

import { useEffect, useState, type ReactElement } from 'react';

import {
  STAGES,
  progressAt,
  stageAt,
} from '@/app/(site)/briefings/_components/briefing-view';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';

/** How often the progress bar moves, in milliseconds. */
const TICK_MS = 200;

/** The class and the mark of one stage: done, the one under way, or still to come. */
function stageLook(i: number, stage: number): readonly [string, string] {
  if (i < stage) return ['text-muted', '✓ '];
  if (i === stage) return ['font-semibold text-ink', '› '];
  return ['text-subtle', ''];
}

/** The page of the briefing a `Location` names, or undefined. */
export function briefingPage(location: string | null): string | undefined {
  const id = /\/briefings\/(\d+)$/.exec(location ?? '')?.[1];
  return id ? `/briefings/${id}` : undefined;
}

/** What to tell the person when writing failed, from the problem it sent. */
export async function failureOf(response: Response): Promise<string> {
  if (response.status === 404) {
    return 'Too few new stories qualify for a briefing yet. Try again later.';
  }
  if (response.status === 429) {
    return 'You have asked for too many briefings. Try again in a minute.';
  }
  try {
    const problem = (await response.json()) as {
      detail?: string;
      title?: string;
    };
    return (
      problem.detail || problem.title || 'The briefing could not be written.'
    );
  } catch {
    return 'The briefing could not be written.';
  }
}

/**
 * "Write a briefing now": asks for one for the slot of the day the person is
 * in, shows its progress through the stages of writing while it is pending,
 * then opens it. A failure is said beneath the button.
 */
export function WriteBriefing(): ReactElement {
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [started]);

  async function write(): Promise<void> {
    const at = Date.now();
    setError(null);
    setStarted(at);
    setNow(at);
    try {
      const response = await fetch('/api/editions/self/briefings', {
        method: 'POST',
      });
      const page = response.ok
        ? briefingPage(response.headers.get('location'))
        : undefined;
      if (page) {
        globalThis.location.assign(page);
        return;
      }
      setError(
        response.ok
          ? 'The briefing was written, but could not be opened.'
          : await failureOf(response),
      );
    } catch {
      setError('Could not reach the server. Check your connection.');
    }
    setStarted(null);
  }

  const elapsed = started === null ? 0 : now - started;
  const stage = stageAt(elapsed);
  return (
    <div className="w-full sm:w-72">
      <Button
        variant="accent"
        onClick={() => void write()}
        disabled={started !== null}
        className="w-full"
      >
        {started === null ? 'Write a briefing now' : 'Writing…'}
      </Button>
      {started === null ? null : (
        <div className="mt-3">
          <progress
            aria-label="Writing the briefing"
            aria-valuetext={STAGES[stage]}
            max={100}
            value={progressAt(elapsed)}
            className="block h-1.5 w-full appearance-none overflow-hidden rounded-full bg-ink/10 [&::-moz-progress-bar]:bg-highlight [&::-webkit-progress-bar]:bg-ink/10 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-highlight"
          />
          <ol className="mt-2 space-y-0.5 text-xs">
            {STAGES.map((name, i) => {
              const [tone, mark] = stageLook(i, stage);
              return (
                <li key={name} className={tone}>
                  {mark}
                  {name}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {started === null ? '' : `${STAGES[stage]}…`}
      </p>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
