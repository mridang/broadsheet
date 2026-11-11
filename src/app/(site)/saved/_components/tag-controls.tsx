'use client';

import { cn } from '@/components/ui/cn';
import { SMALL_FIELD } from '@/components/ui/field';
import { useState, type ReactElement } from 'react';

import { ensureOk } from '@/components/api/problem-message';
import { useApiAction } from '@/components/api/use-api-action';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';

const path = (tag: string) =>
  `/api/users/self/saves/tags/${encodeURIComponent(tag)}`;

/**
 * Rename a saved-story tag (merging into one of the new name) or take it off
 * every save; then show the renamed tag, or every save.
 */
export function TagControls({ tag }: Readonly<{ tag: string }>): ReactElement {
  const [name, setName] = useState(tag);
  const action = useApiAction();
  const go = (to: string) => globalThis.location.assign(to);

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(async () => {
          await ensureOk(
            await fetch(path(tag), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name }),
            }),
          );
          go(`/saved?tag=${encodeURIComponent(name.trim())}`);
        }, 'Could not rename the tag.');
      }}
    >
      <input
        aria-label="Rename tag"
        className={cn(SMALL_FIELD, 'w-40')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button type="submit" variant="outline" size="xs" disabled={action.busy}>
        Rename
      </Button>
      <Button
        variant="danger"
        size="xs"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            await ensureOk(await fetch(path(tag), { method: 'DELETE' }));
            go('/saved');
          }, 'Could not delete the tag.')
        }
      >
        Delete tag
      </Button>
      {action.error ? (
        <div className="basis-full">
          <ErrorText>{action.error}</ErrorText>
        </div>
      ) : null}
    </form>
  );
}
