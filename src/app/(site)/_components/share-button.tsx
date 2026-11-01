'use client';

import { useId, useRef, useState, type ReactElement } from 'react';

import { problemText } from '@/components/api/problem-message';
import { setShared } from '@/app/(site)/_components/story-requests';
import { CHIP } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HINT } from '@/components/ui/field';
import { Menu } from '@/components/ui/menu';

/**
 * "Share" on a story, as NewsBlur's share dialog: a popover with an optional
 * comment that shares the story (or changes its comment), and a button that
 * stops sharing it. Shares are public, so the popover says so.
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

  const name = `${isShared ? 'Shared' : 'Share'} ${title}`;
  const failure = error ? (
    <p className="mt-2 text-xs text-danger" role="alert">
      {error}
    </p>
  ) : null;
  const form = (
    <form
      className={inline ? 'px-3 pt-1 pb-2' : 'p-2.5'}
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
        className="mt-1.5"
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
      {inline ? failure : null}
    </form>
  );

  if (!inline) {
    // A popover in the top layer; its error stays beside the button, since
    // choosing Share or Unshare closes the panel.
    return (
      <span
        className="pointer-events-auto relative z-10 inline-flex flex-col print:hidden"
        data-action="share"
      >
        <Menu
          label={name}
          width="w-72"
          triggerClassName={summaryClassName}
          trigger={isShared ? '✓ Shared' : 'Share'}
        >
          {form}
        </Menu>
        {failure}
      </span>
    );
  }

  return (
    <details ref={panel} className="w-full print:hidden">
      <summary
        className={summaryClassName}
        data-action="share"
        aria-label={name}
      >
        {isShared ? '✓ Shared' : 'Share'}
      </summary>
      {form}
    </details>
  );
}
