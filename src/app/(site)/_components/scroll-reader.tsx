'use client';

import { useEffect } from 'react';

import { markRead } from '@/app/(site)/_components/story-requests';

/** The stories that can be marked read: those carrying an article id. */
const STORY = 'article[data-article-id]';

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
        const card = entry.target as HTMLElement;
        const id = Number(card.dataset['articleId']);
        const above = entry.boundingClientRect.bottom <= 0;
        if (!id || entry.isIntersecting || !above || seen.has(id)) {
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
