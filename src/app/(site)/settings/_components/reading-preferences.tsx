'use client';

import { useState, type ReactElement } from 'react';

import { ensureOk } from '@/components/api/problem-message';
import { useApiAction } from '@/components/api/use-api-action';

/** The intelligence levels, as the reader picks them. */
const LEVELS = [
  ['focus', 'Focus: only stories you like'],
  ['unread', 'Unread: all but stories you dislike'],
  ['all', 'All: every story, disliked ones last'],
] as const;

/**
 * How the reader reads: how much of the paper their training lets through,
 * whether opening a story marks it read, and after how many days stories
 * count as read anyway (0 never). Each change is saved at once.
 */
export function ReadingPreferences({
  intelligence,
  markReadOnOpen,
  autoMarkReadDays,
}: Readonly<{
  intelligence: string;
  markReadOnOpen: boolean;
  autoMarkReadDays: number;
}>): ReactElement {
  const [level, setLevel] = useState(intelligence);
  const [onOpen, setOnOpen] = useState(markReadOnOpen);
  const [days, setDays] = useState(String(autoMarkReadDays));
  const action = useApiAction();
  const save = (change: Record<string, unknown>) =>
    action.run(async () => {
      await ensureOk(
        await fetch('/api/users/self/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(change),
        }),
      );
    }, 'Could not save the preference.');

  return (
    <div>
      <label>
        Show{' '}
        <select
          value={level}
          disabled={action.busy}
          onChange={(e) => {
            setLevel(e.target.value);
            void save({ intelligence: e.target.value });
          }}
        >
          {LEVELS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p>
        <label>
          <input
            type="checkbox"
            checked={onOpen}
            disabled={action.busy}
            onChange={(e) => {
              setOnOpen(e.target.checked);
              void save({ mark_read_on_open: e.target.checked });
            }}
          />{' '}
          Mark a story read when I open it
        </label>
      </p>
      <p>
        <label>
          Count stories as read after{' '}
          <input
            type="number"
            min={0}
            max={365}
            value={days}
            disabled={action.busy}
            onChange={(e) => setDays(e.target.value)}
            onBlur={() => void save({ auto_mark_read_days: Number(days) })}
          />{' '}
          days (0 never)
        </label>
      </p>
      {action.error ? <p role="alert">{action.error}</p> : null}
    </div>
  );
}
