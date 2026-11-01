'use client';

import { useEffect, useRef, type ReactElement } from 'react';

import {
  SHORTCUTS,
  focusedStory,
  isTyping,
  nextUnread,
  sectionStep,
  shortcutFor,
  step,
} from '@/app/(site)/_components/shortcuts';
import { markRead, markUnread } from '@/app/(site)/_components/story-requests';

/** The link that covers each story; focusing it is focusing the story. */
const STORY = 'article.card > a.hit';

/**
 * NewsBlur's reading keys on the paper: j/k (and the arrows, once a story has
 * focus) move between stories, n to the next unread, J/K between sections;
 * o opens the focused story, X its full text and i its questions; s saves it,
 * u marks it read or unread, y reads it aloud; r reloads, / searches and ?
 * lists the keys. Keys typed into a field are left alone. The stories' links take the focus, so
 * Tab, the focus ring and a screen reader all follow the same place j and k do.
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
      const cards = stories.map((s) => s.parentElement ?? s);
      const current = focusedStory(cards, document.activeElement);
      const card = cards[current];
      const act = (selector: string) => {
        const control = card?.querySelector<HTMLElement>(selector);
        if (!control) return;
        event.preventDefault();
        control.click();
      };
      const go = (to: number) => {
        if (to < 0) return;
        event.preventDefault();
        stories[to]?.focus();
        stories[to]?.scrollIntoView({ block: 'nearest' });
      };
      switch (shortcut) {
        case 'next':
        case 'prev':
          // The arrows scroll the page until a story has focus.
          if (event.key.startsWith('Arrow') && current < 0) return;
          go(step(current, stories.length, shortcut));
          return;
        case 'next-unread':
          go(
            nextUnread(
              cards.map((c) => c.classList.contains('read')),
              current,
            ),
          );
          return;
        case 'next-section':
        case 'prev-section': {
          const zones = Array.from(document.querySelectorAll('section.zone'));
          go(
            sectionStep(
              cards.map((c) => zones.findIndex((z) => z.contains(c))),
              current,
              shortcut === 'next-section' ? 'next' : 'prev',
            ),
          );
          return;
        }
        case 'open':
          // Enter on a link or button already does its own thing.
          if (event.key === 'Enter') return;
          if (current >= 0) {
            event.preventDefault();
            stories[current]?.click();
          }
          return;
        case 'full-text':
          act('a[data-action="full-text"]');
          return;
        case 'ask': {
          const text = card?.querySelector<HTMLAnchorElement>(
            'a[data-action="full-text"]',
          );
          if (!text) return;
          event.preventDefault();
          window.location.assign(`${text.href}#ask`);
          return;
        }
        case 'save':
          act('button[data-action="save"]');
          return;
        case 'listen':
          act('button[data-action="listen"]');
          return;
        case 'read': {
          const id = Number(card?.dataset['articleId']);
          if (!card || !id) return;
          event.preventDefault();
          if (card.classList.toggle('read')) markRead(id);
          else markUnread(id);
          return;
        }
        case 'reload':
          event.preventDefault();
          window.location.reload();
          return;
        case 'search':
          event.preventDefault();
          window.location.assign('/search');
          return;
      }
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
