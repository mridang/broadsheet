'use client';

import { useId, useRef, useState, type ReactElement } from 'react';

import { problemText } from '@/components/api/problem-message';
import { setShared } from '@/app/(site)/_components/story-requests';
import { CHIP } from '@/app/(site)/_components/story-actions';

/**
 * "Share" on a story, as NewsBlur's share dialog: a popover with an optional
 * comment that shares the story (or changes its comment), and a button that
 * stops sharing it. Shares are public, so the popover says so. On a phone the
 * popover is a sheet along the bottom of the screen.
 */
export function ShareButton({
  articleId,
  shared,
  title,
}: Readonly<{
  articleId: number;
  shared: boolean;
  title: string;
}>): ReactElement {
  const [isShared, setIsShared] = useState(shared);
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const panel = useRef<HTMLDetailsElement>(null);
  const field = useId();

  async function run(share: boolean): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await setShared(articleId, share, comments);
      setIsShared(share);
      if (panel.current) panel.current.open = false;
    } catch (err) {
      setError(problemText(err, 'Could not share.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details ref={panel} className="relative z-10 print:hidden">
      <summary
        className={CHIP}
        data-action="share"
        aria-label={`${isShared ? 'Shared' : 'Share'} ${title}`}
      >
        {isShared ? '✓ Shared' : 'Share'}
      </summary>
      <form
        className="pointer-events-auto fixed inset-x-4 bottom-4 z-20 rounded-card border border-line bg-surface p-4 shadow-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:mt-2 sm:w-72"
        onSubmit={(e) => {
          e.preventDefault();
          void run(true);
        }}
      >
        <label htmlFor={field} className="text-xs font-medium text-ink">
          Comment <span className="text-subtle">(optional)</span>
        </label>
        <textarea
          id={field}
          rows={3}
          maxLength={5000}
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          className="focus-ring-flush mt-1 w-full rounded-control border border-field bg-paper p-2 text-sm text-ink"
        />
        <p className="mt-1 text-xs text-subtle">
          Anyone signed in sees your share and your name.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="focus-ring h-8 rounded-control bg-ink px-3 text-xs font-semibold text-on-ink disabled:opacity-50"
          >
            {isShared ? 'Update' : 'Share'}
          </button>
          {isShared ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(false)}
              className="focus-ring h-8 rounded-control border border-field px-3 text-xs font-semibold text-ink disabled:opacity-50"
            >
              Unshare
            </button>
          ) : null}
        </div>
        {error ? (
          <p
            className="mt-2 text-xs text-red-700 dark:text-red-400"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
