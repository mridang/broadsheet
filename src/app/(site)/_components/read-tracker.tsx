'use client';

import { useEffect } from 'react';

import { markRead } from '@/app/(site)/_components/story-requests';

/** The link that covers each story, carrying the story's article id. */
const STORY = 'article[data-article-id] > a[data-story-link]';

/**
 * Notes a story as read when its link is opened (a click, a middle click or
 * `o`), and dims it at once. Renders nothing.
 */
export function ReadTracker(): null {
  useEffect(() => {
    function onOpen(event: MouseEvent) {
      const link = (event.target as Element | null)?.closest?.(STORY);
      const card = link?.parentElement;
      const id = Number(card?.dataset['articleId']);
      if (!card || !id) return;
      card.toggleAttribute('data-read', true);
      markRead(id);
    }
    document.addEventListener('click', onOpen);
    document.addEventListener('auxclick', onOpen);
    return () => {
      document.removeEventListener('click', onOpen);
      document.removeEventListener('auxclick', onOpen);
    };
  }, []);
  return null;
}
