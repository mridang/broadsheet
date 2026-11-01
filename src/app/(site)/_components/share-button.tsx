'use client';

import { useId, useRef, useState, type ReactElement } from 'react';

import { problemText } from '@/components/api/problem-message';
import { setShared } from '@/app/(site)/_components/story-requests';
import { CHIP } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { HINT, textareaClass } from '@/components/ui/field';

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
  inline = false,
  summaryClassName = CHIP,
}: Readonly<{
  articleId: number;
  shared: boolean;
  title: string;
  /** Opens in place beneath its button (inside a menu), not as a popover. */
  inline?: boolean;
  /** The look of the button that opens it. */
  summaryClassName?: string;
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
    <details
      ref={panel}
      className={cn('relative z-10 print:hidden', inline && 'w-full')}
    >
      <summary
        className={summaryClassName}
        data-action="share"
        aria-label={`${isShared ? 'Shared' : 'Share'} ${title}`}
      >
        {isShared ? '✓ Shared' : 'Share'}
      </summary>
      <form
        className={
          inline
            ? 'px-3 pt-1 pb-2'
            : 'pointer-events-auto fixed inset-x-4 bottom-4 z-20 rounded-card border border-line bg-surface p-4 shadow-overlay sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:mt-2 sm:w-72'
        }
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
          className={textareaClass('mt-1.5')}
        />
        <p className={HINT}>Anyone signed in sees your share and your name.</p>
        <div className="mt-3 flex items-center gap-2">
          <Button type="submit" size="xs" disabled={busy}>
            {isShared ? 'Update' : 'Share'}
          </Button>
          {isShared ? (
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => void run(false)}
            >
              Unshare
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="mt-2 text-xs text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
