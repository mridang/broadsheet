'use client';

import { useEffect, useRef, type ReactElement } from 'react';

import {
  SHORTCUTS,
  isTyping,
  shortcutFor,
  step,
} from '@/app/(site)/_components/shortcuts';

/** The link that covers each story; focusing it is focusing the story. */
const STORY = 'article.card > a.hit';

/**
 * j/k move focus between the stories, o (or Enter) opens the focused one and
 * ? toggles a list of the keys. Keys typed into a field are left alone. The
 * stories' links take the focus, so Tab, the focus ring and a screen reader
 * all follow the same place j and k do.
 */
export function KeyboardShortcuts(): ReactElement {
  const help = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (isTyping(target)) return;
      const shortcut = shortcutFor(event);
      if (!shortcut) return;
      const dialog = help.current;
      if (shortcut === 'help') {
        event.preventDefault();
        if (dialog?.open) dialog.close();
        else dialog?.showModal();
        return;
      }
      if (dialog?.open) return;
      const stories = Array.from(document.querySelectorAll<HTMLElement>(STORY));
      const current = stories.findIndex((s) => s === document.activeElement);
      if (shortcut === 'open') {
        // Enter on a link or button already does its own thing.
        if (event.key === 'Enter') return;
        if (current >= 0) {
          event.preventDefault();
          stories[current]?.click();
        }
        return;
      }
      const to = step(current, stories.length, shortcut);
      if (to < 0) return;
      event.preventDefault();
      stories[to]?.focus();
      stories[to]?.scrollIntoView({ block: 'nearest' });
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <dialog ref={help} className="keyhelp" aria-labelledby="keyhelp-title">
      <h2 id="keyhelp-title">Keyboard shortcuts</h2>
      <dl>
        {SHORTCUTS.map(([keys, does]) => (
          <div key={keys}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{does}</dd>
          </div>
        ))}
      </dl>
      <form method="dialog">
        <button type="submit" className="btn small focus-ring">
          Close
        </button>
      </form>
    </dialog>
  );
}
