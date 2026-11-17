'use client';

import { useEffect } from 'react';

import { markRead } from '@/app/(site)/_components/story-requests';

/** The stories that can be marked read: those carrying an article id. */
const STORY = 'article[data-article-id]';

/** The story an observation says has left the top of the window, if it has. */
function scrolledPast(
  entry: IntersectionObserverEntry,
): HTMLElement | undefined {
  const card = entry.target;
  const gone = !entry.isIntersecting && entry.boundingClientRect.bottom <= 0;
  return card instanceof HTMLElement && gone ? card : undefined;
}

/**
 * NewsBlur's mark-read-on-scroll: a story is noted as read, and dimmed, once
 * the reader has scrolled past it (it left the top of the window). Renders
 * nothing.
 */
export function ScrollReader(): null {
  useEffect(() => {
    const seen = new Set<number>();
    const observer = new IntersectionObserver((entries) => {
      // eslint-disable-next-line functional/no-loop-statements -- marks each story scrolled past, with DOM side effects
      for (const entry of entries) {
        const card = scrolledPast(entry);
        const id = Number(card?.dataset['articleId']);
        if (!card || !id || seen.has(id)) {
          continue;
        }
        // eslint-disable-next-line functional/immutable-data -- remembers which stories were marked
        seen.add(id);
        card.classList.add('read');
        markRead(id);
      }
    });
    // eslint-disable-next-line functional/no-loop-statements -- starts observing each story
    for (const card of document.querySelectorAll<HTMLElement>(STORY)) {
      observer.observe(card);
    }
    return () => observer.disconnect();
  }, []);
  return null;
}
