'use client';

import { useState, type ReactElement, type ReactNode } from 'react';

import { ensureOk } from '@/components/api/problem-message';
import { useApiAction } from '@/components/api/use-api-action';
import { Card } from '@/components/ui/card';
import { Toggle } from '@/components/ui/input';
import { ErrorText } from '@/components/ui/notice';

/** The intelligence levels, as the reader picks them. */
const LEVELS = [
  ['focus', 'Focus: only stories you like'],
  ['unread', 'Unread: all but stories you dislike'],
  ['all', 'All: every story, disliked ones last'],
] as const;

/**
 * How the reader reads: how much of the paper their training lets through,
 * whether opening a story or scrolling past it marks it read, and after how
 * many days stories count as read anyway (0 never). Each change is saved at once.
 */
export function ReadingPreferences({
  intelligence,
  markReadOnOpen,
  autoMarkReadDays,
  markReadOnScroll,
}: Readonly<{
  intelligence: string;
  markReadOnOpen: boolean;
  autoMarkReadDays: number;
  markReadOnScroll: boolean;
}>): ReactElement {
  const [level, setLevel] = useState(intelligence);
  const [onOpen, setOnOpen] = useState(markReadOnOpen);
  const [days, setDays] = useState(String(autoMarkReadDays));
  const [onScroll, setOnScroll] = useState(markReadOnScroll);
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
    <Card padding="none" className="divide-y divide-line">
      <SettingRow
        label="Show"
        description="How much of the paper your training lets through."
      >
        <select
          aria-label="Which stories to show"
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
      </SettingRow>
      <div className="px-5 py-4">
        <Toggle
          label="Mark a story read when I open it"
          checked={onOpen}
          disabled={action.busy}
          onChange={(e) => {
            setOnOpen(e.target.checked);
            void save({ mark_read_on_open: e.target.checked });
          }}
        />
      </div>
      <div className="px-5 py-4">
        <Toggle
          label="Mark stories read as I scroll past them"
          checked={onScroll}
          disabled={action.busy}
          onChange={(e) => {
            setOnScroll(e.target.checked);
            void save({ mark_read_on_scroll: e.target.checked });
          }}
        />
      </div>
      <SettingRow
        label="Count stories as read after"
        description="In days; 0 never marks them."
      >
        <span className="inline-flex items-center gap-2 text-sm text-muted">
          <input
            type="number"
            aria-label="Days until stories count as read"
            className="w-20"
            min={0}
            max={365}
            value={days}
            disabled={action.busy}
            onChange={(e) => setDays(e.target.value)}
            onBlur={() => void save({ auto_mark_read_days: Number(days) })}
          />
          days
        </span>
      </SettingRow>
      {action.error ? (
        <div className="px-5 pb-4">
          <ErrorText>{action.error}</ErrorText>
        </div>
      ) : null}
    </Card>
  );
}

/** One setting: its words on the left, its control on the right. */
function SettingRow({
  label,
  description,
  children,
}: Readonly<{
  label: string;
  description?: string;
  children: ReactNode;
}>): ReactElement {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        {description ? (
          <p className="mt-0.5 text-xs text-subtle">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
