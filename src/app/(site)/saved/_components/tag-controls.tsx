'use client';

import { useState, type ReactElement } from 'react';

import { ensureOk } from '@/components/api/problem-message';
import { useApiAction } from '@/components/api/use-api-action';
import { Button } from '@/components/ui/button';

const path = (tag: string) =>
  `/api/users/self/saves/tags/${encodeURIComponent(tag)}`;

/**
 * Rename a saved-story tag (merging into one of the new name) or take it off
 * every save; then show the renamed tag, or every save.
 */
export function TagControls({ tag }: Readonly<{ tag: string }>): ReactElement {
  const [name, setName] = useState(tag);
  const action = useApiAction();
  const go = (to: string) => window.location.assign(to);

  return (
    <form
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
      <label>
        Rename tag{' '}
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>{' '}
      <Button type="submit" variant="outline" size="sm" disabled={action.busy}>
        Rename
      </Button>{' '}
      <Button
        variant="ghost"
        size="sm"
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
      {action.error ? <p role="alert">{action.error}</p> : null}
    </form>
  );
}
