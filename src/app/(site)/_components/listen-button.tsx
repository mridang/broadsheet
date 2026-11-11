'use client';

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';

import {
  EMPTY,
  finish,
  getPlayer,
  loadPlayer,
  progress,
  start,
  subscribePlayer,
  toggleQueued,
  updatePlayer,
} from '@/app/(site)/_components/player';
import { webSpeech, type ReadAloud } from '@/app/(site)/_components/read-aloud';
import { CHIP } from '@/app/(site)/_components/story-actions';
import { cn } from '@/components/ui/cn';

/** One reader for the page, so starting one story stops the last. */
let shared: ReadAloud | null | undefined;

/** Whether the person's player was asked for yet. */
let loading: Promise<void> | undefined;

/** The page's reader, made on first use. */
function browserReader(): ReadAloud | null {
  if (shared === undefined) shared = webSpeech(globalThis);
  return shared;
}

/** Speech support never changes while the page is open. */
function subscribe(): () => void {
  return () => undefined;
}

/** Press the Listen button of the story with this id, if it is on the page. */
function listenTo(id: number): void {
  document
    .querySelector<HTMLButtonElement>(
      `button[data-action="listen"][data-article-id="${CSS.escape(String(id))}"]`,
    )
    ?.click();
}

/**
 * "Listen" on a story: reads its headline and excerpt aloud at the person's
 * rate, picking up where they left off, and stops on a second press. When it
 * comes to its end the next queued story plays. "Queue" adds the story to (or
 * takes it out of) what plays next. It renders nothing on the server or where
 * the browser cannot speak, and neither prints.
 */
export function ListenButton({
  articleId,
  text,
  title,
  className = CHIP,
}: Readonly<{
  articleId: number;
  text: string;
  title: string;
  /** The look of both buttons: a chip by default, a menu row in a menu. */
  className?: string;
}>): ReactElement | null {
  // Support is only known in the browser, so the server renders no button.
  const reader = useSyncExternalStore(subscribe, browserReader, () => null);
  const player = useSyncExternalStore(subscribePlayer, getPlayer, () => EMPTY);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (reader) loading ??= loadPlayer();
  }, [reader]);

  if (!reader) return null;
  const queued = player.queue.includes(articleId);
  return (
    <>
      <button
        type="button"
        className={cn(className, 'print:hidden')}
        data-action="listen"
        data-article-id={articleId}
        aria-pressed={playing}
        aria-label={`${playing ? 'Stop reading' : 'Listen to'} ${title}`}
        onClick={() => {
          if (playing) {
            reader.stop();
            setPlaying(false);
            return;
          }
          updatePlayer((p) => start(p, articleId));
          const now = getPlayer();
          reader.play(
            text,
            (completed) => {
              setPlaying(false);
              if (!completed) return;
              const { player: after, next } = finish(getPlayer());
              updatePlayer(() => after);
              if (next !== undefined) listenTo(next);
            },
            {
              rate: now.rate,
              from: now.current?.position ?? 0,
              onProgress: (at) => updatePlayer((p) => progress(p, at)),
            },
          );
          setPlaying(true);
        }}
      >
        {playing ? '■ Stop' : '▶ Listen'}
      </button>
      <button
        type="button"
        className={cn(className, 'print:hidden')}
        data-action="queue"
        aria-pressed={queued}
        aria-label={`${queued ? 'Take out of the queue' : 'Queue'} ${title}`}
        onClick={() => updatePlayer((p) => toggleQueued(p, articleId))}
      >
        {queued ? '✓ Queued' : '+ Queue'}
      </button>
    </>
  );
}
