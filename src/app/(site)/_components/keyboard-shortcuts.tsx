'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';

import { stepRate, updatePlayer } from '@/app/(site)/_components/player';
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
import { buttonClass } from '@/components/ui/button';

/** The link that covers each story; focusing it is focusing the story. */
const STORY = 'article[data-story] > a[data-story-link]';

/** What a collapsed story hides: everything below its headline. */
const BODY = '[data-part]';

/** A section of the paper, for the `g` picker. */
type Desk = Readonly<{ name: string; first: number }>;

/** The paper's sections, each with the index of its first story. */
function desks(cards: readonly HTMLElement[]): Desk[] {
  return [...document.querySelectorAll('section[data-desk]')].flatMap(
    (zone) => {
      const first = cards.findIndex((card) => zone.contains(card));
      const name = zone.querySelector('h3')?.textContent?.trim() ?? '';
      return first !== -1 && name ? [{ name, first }] : [];
    },
  );
}

/**
 * NewsBlur's reading keys on the paper, listed in full by `?`. They move
 * between stories, sections and editions; open, expand, collapse, save, mark
 * and read aloud the focused story; and hide the top bar or go full screen. Keys typed into a field are left alone. The stories' links take
 * the focus, so Tab, the focus ring and a screen reader all follow the same
 * place j and k do.
 */
export function KeyboardShortcuts(): ReactElement {
  const help = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLDialogElement>(null);
  const [sections, setSections] = useState<Desk[]>([]);
  const [query, setQuery] = useState('');

  // eslint-disable-next-line sonarjs/max-lines-per-function -- splitting the key handler is a logic rewrite that would be large
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
      const stories = [...document.querySelectorAll<HTMLElement>(STORY)];
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
        globalThis.location.assign(url);
      };
      const go = (to: number) => {
        if (to < 0) return;
        take();
        stories[to]?.focus();
        stories[to]?.scrollIntoView({ block: 'nearest' });
      };
      const unread = () => cards.map((c) => Object.hasOwn(c.dataset, 'read'));
      switch (shortcut) {
        case 'next':
        case 'prev': {
          // The arrows scroll the page until a story has focus.
          if (event.key.startsWith('Arrow') && current < 0) return;
          go(step(current, stories.length, shortcut));
          return;
        }
        case 'next-unread': {
          go(nextUnread(unread(), current));
          return;
        }
        case 'last-unread': {
          go(lastUnread(unread()));
          return;
        }
        case 'next-section':
        case 'prev-section': {
          const zones = [...document.querySelectorAll('section[data-desk]')];
          go(
            sectionStep(
              cards.map((c) => zones.findIndex((z) => z.contains(c))),
              current,
              shortcut === 'next-section' ? 'next' : 'prev',
            ),
          );
          return;
        }
        case 'go-section': {
          take();
          setSections(desks(cards));
          setQuery('');
          picker.current?.showModal();
          return;
        }
        case 'older-edition': {
          act('a[aria-label="Previous day"]', document);
          return;
        }
        case 'newer-edition': {
          act('a[aria-label="Next day"]', document);
          return;
        }
        case 'everything': {
          visit('/');
          return;
        }
        case 'deselect': {
          if (current >= 0) (document.activeElement as HTMLElement).blur();
          return;
        }
        case 'open': {
          // Enter on a link or button already does its own thing.
          if (event.key === 'Enter') return;
          if (current >= 0) {
            take();
            stories[current]?.click();
          }
          return;
        }
        case 'open-background': {
          const link = stories[current] as HTMLAnchorElement | undefined;
          if (!link) return;
          take();
          window.open(link.href, '_blank', 'noopener');
          return;
        }
        case 'full-text': {
          act('a[data-action="full-text"]');
          return;
        }
        case 'collapse':
        case 'expand': {
          if (!card) return;
          take();
          card.querySelectorAll<HTMLElement>(BODY).forEach((part) => {
            part.hidden = shortcut === 'collapse';
          });
          return;
        }
        case 'comments': {
          visit(card?.dataset['commentsUrl']);
          return;
        }
        case 'ask': {
          const text = card?.querySelector<HTMLAnchorElement>(
            'a[data-action="full-text"]',
          );
          visit(text ? `${text.href}#ask` : undefined);
          return;
        }
        case 'save': {
          act('button[data-action="save"]');
          return;
        }
        case 'listen': {
          act('button[data-action="listen"]');
          return;
        }
        case 'queue': {
          act('button[data-action="queue"]');
          return;
        }
        case 'slower':
        case 'faster': {
          take();
          updatePlayer((p) => ({
            ...p,
            rate: stepRate(p.rate, shortcut === 'faster' ? 'up' : 'down'),
          }));
          return;
        }
        case 'read': {
          const id = Number(card?.dataset['articleId']);
          if (!card || !id) return;
          take();
          if (card.toggleAttribute('data-read')) markRead(id);
          else markUnread(id);
          return;
        }
        case 'read-all':
        case 'read-above':
        case 'read-below': {
          const marked = storiesToMark(cards.length, current, shortcut)
            .map((i) => cards[i]!)
            .filter((c) => c.dataset['articleId']);
          if (marked.length === 0) return;
          take();
          marked.forEach((c) => c.toggleAttribute('data-read', true));
          markManyRead(marked.map((c) => Number(c.dataset['articleId'])));
          return;
        }
        case 'reload': {
          take();
          globalThis.location.reload();
          return;
        }
        case 'refresh': {
          take();
          void refreshFeeds()
            .then(() => globalThis.location.reload())
            .catch(() => undefined);
          return;
        }
        case 'search': {
          visit('/search');
          return;
        }
        case 'fullscreen': {
          take();
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.();
          return;
        }
        case 'masthead': {
          const bar = document.querySelector<HTMLElement>(
            'header[data-top-bar]',
          );
          if (!bar) return;
          take();
          bar.hidden = !bar.hidden;
          return;
        }
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
      <dialog
        ref={help}
        className="m-auto max-h-[85dvh] w-full max-w-md rounded-card border border-line bg-surface p-6 text-ink shadow-overlay backdrop:bg-black/40 max-sm:max-w-[calc(100vw-2rem)]"
        aria-labelledby="keyhelp-title"
      >
        <h2 id="keyhelp-title" className="text-lg font-semibold">
          Keyboard shortcuts
        </h2>
        <dl className="mt-4 divide-y divide-line text-sm">
          {SHORTCUTS.map(([keys, does]) => (
            <div key={keys} className="flex gap-4 py-2">
              <dt className="w-24 shrink-0">
                <kbd className="rounded-control border border-line bg-ink/5 px-1.5 py-0.5 font-mono text-xs">
                  {keys}
                </kbd>
              </dt>
              <dd className="text-muted">{does}</dd>
            </div>
          ))}
        </dl>
        <form method="dialog" className="mt-5">
          <button
            type="submit"
            className={buttonClass({ variant: 'outline', size: 'sm' })}
          >
            Close
          </button>
        </form>
      </dialog>
      <dialog
        ref={picker}
        className="m-auto w-full max-w-md rounded-card border border-line bg-surface p-6 text-ink shadow-overlay backdrop:bg-black/40 max-sm:max-w-[calc(100vw-2rem)]"
        aria-labelledby="goto-title"
      >
        <h2 id="goto-title" className="text-lg font-semibold">
          Go to a section
        </h2>
        <form
          className="mt-4"
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
            className="w-full"
          />
        </form>
        <dl className="mt-3 max-h-80 overflow-y-auto">
          {shown.map((desk) => (
            <div key={desk.first}>
              <dd>
                <button
                  type="button"
                  className={buttonClass({
                    variant: 'ghost',
                    size: 'sm',
                    className: 'w-full justify-start font-medium',
                  })}
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
