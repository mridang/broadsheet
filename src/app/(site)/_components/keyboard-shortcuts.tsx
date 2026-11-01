'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';

import { refreshFeeds } from '@/app/(site)/feeds/_components/feed-requests';
import {
  SHORTCUTS,
  focusedStory,
  isTyping,
  lastUnread,
  matchSections,
  nextUnread,
  sectionStep,
  shortcutFor,
  step,
  storiesToMark,
} from '@/app/(site)/_components/shortcuts';
import {
  markManyRead,
  markRead,
  markUnread,
} from '@/app/(site)/_components/story-requests';

/** The link that covers each story; focusing it is focusing the story. */
const STORY = 'article.card > a.hit';

/** What a collapsed story hides: everything below its headline. */
const BODY = '.ph, .ex, .also';

/** A section of the paper, for the `g` picker. */
type Desk = Readonly<{ name: string; first: number }>;

/** The paper's sections, each with the index of its first story. */
function desks(cards: readonly HTMLElement[]): Desk[] {
  return Array.from(document.querySelectorAll('section.zone')).flatMap(
    (zone) => {
      const first = cards.findIndex((card) => zone.contains(card));
      const name = zone.querySelector('h3')?.textContent?.trim() ?? '';
      return first >= 0 && name ? [{ name, first }] : [];
    },
  );
}

/**
 * NewsBlur's reading keys on the paper, listed in full by `?`. They move
 * between stories, sections and editions; open, expand, collapse, save, mark
 * and read aloud the focused story; and switch the page's style, masthead and
 * full screen. Keys typed into a field are left alone. The stories' links take
 * the focus, so Tab, the focus ring and a screen reader all follow the same
 * place j and k do.
 */
export function KeyboardShortcuts(): ReactElement {
  const help = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLDialogElement>(null);
  const [sections, setSections] = useState<Desk[]>([]);
  const [query, setQuery] = useState('');

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
      if (dialog?.open || picker.current?.open) return;
      const stories = Array.from(document.querySelectorAll<HTMLElement>(STORY));
      const cards = stories.map((s) => s.parentElement ?? s);
      const current = focusedStory(cards, document.activeElement);
      const card = cards[current];
      const take = () => event.preventDefault();
      const act = (selector: string, root?: ParentNode) => {
        const control = (root ?? card)?.querySelector<HTMLElement>(selector);
        if (!control) return;
        take();
        control.click();
      };
      const visit = (url: string | undefined) => {
        if (!url) return;
        take();
        window.location.assign(url);
      };
      const go = (to: number) => {
        if (to < 0) return;
        take();
        stories[to]?.focus();
        stories[to]?.scrollIntoView({ block: 'nearest' });
      };
      const unread = () => cards.map((c) => c.classList.contains('read'));
      switch (shortcut) {
        case 'next':
        case 'prev':
          // The arrows scroll the page until a story has focus.
          if (event.key.startsWith('Arrow') && current < 0) return;
          go(step(current, stories.length, shortcut));
          return;
        case 'next-unread':
          go(nextUnread(unread(), current));
          return;
        case 'last-unread':
          go(lastUnread(unread()));
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
        case 'go-section':
          take();
          setSections(desks(cards));
          setQuery('');
          picker.current?.showModal();
          return;
        case 'older-edition':
          act('a[aria-label="Previous day"]', document);
          return;
        case 'newer-edition':
          act('a[aria-label="Next day"]', document);
          return;
        case 'everything':
          visit('/');
          return;
        case 'deselect':
          if (current >= 0) (document.activeElement as HTMLElement).blur();
          return;
        case 'open':
          // Enter on a link or button already does its own thing.
          if (event.key === 'Enter') return;
          if (current >= 0) {
            take();
            stories[current]?.click();
          }
          return;
        case 'open-background': {
          const link = stories[current] as HTMLAnchorElement | undefined;
          if (!link) return;
          take();
          window.open(link.href, '_blank', 'noopener');
          return;
        }
        case 'full-text':
          act('a[data-action="full-text"]');
          return;
        case 'collapse':
        case 'expand':
          if (!card) return;
          take();
          card.querySelectorAll<HTMLElement>(BODY).forEach((part) => {
            part.hidden = shortcut === 'collapse';
          });
          return;
        case 'comments':
          visit(card?.dataset['commentsUrl']);
          return;
        case 'ask': {
          const text = card?.querySelector<HTMLAnchorElement>(
            'a[data-action="full-text"]',
          );
          visit(text ? `${text.href}#ask` : undefined);
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
          take();
          if (card.classList.toggle('read')) markRead(id);
          else markUnread(id);
          return;
        }
        case 'read-all':
        case 'read-above':
        case 'read-below': {
          const marked = storiesToMark(cards.length, current, shortcut)
            .map((i) => cards[i]!)
            .filter((c) => c.dataset['articleId']);
          if (!marked.length) return;
          take();
          marked.forEach((c) => c.classList.add('read'));
          markManyRead(marked.map((c) => Number(c.dataset['articleId'])));
          return;
        }
        case 'reload':
          take();
          window.location.reload();
          return;
        case 'refresh':
          take();
          void refreshFeeds()
            .then(() => window.location.reload())
            .catch(() => undefined);
          return;
        case 'search':
          visit('/search');
          return;
        case 'fullscreen':
          take();
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.();
          return;
        case 'masthead': {
          const mast = document.querySelector<HTMLElement>('header.mast');
          if (!mast) return;
          take();
          mast.hidden = !mast.hidden;
          return;
        }
        case 'theme':
          act('.switcher button[aria-pressed="false"]', document);
          return;
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const shown = matchSections(
    sections.map((s) => s.name),
    query,
  ).map((i) => sections[i]!);

  /** Focus the first story of a section, and close the picker. */
  function choose(desk: Desk) {
    picker.current?.close();
    const story = document.querySelectorAll<HTMLElement>(STORY)[desk.first];
    story?.focus();
    story?.scrollIntoView({ block: 'nearest' });
  }

  return (
    <>
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
      <dialog ref={picker} className="keyhelp" aria-labelledby="goto-title">
        <h2 id="goto-title">Go to a section</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (shown[0]) choose(shown[0]);
          }}
        >
          <input
            type="search"
            aria-label="Section name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
        <dl>
          {shown.map((desk) => (
            <div key={desk.first}>
              <dd>
                <button
                  type="button"
                  className="btn ghost small focus-ring"
                  onClick={() => choose(desk)}
                >
                  {desk.name}
                </button>
              </dd>
            </div>
          ))}
        </dl>
      </dialog>
    </>
  );
}
