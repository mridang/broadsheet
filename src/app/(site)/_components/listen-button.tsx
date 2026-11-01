'use client';

import { useState, useSyncExternalStore, type ReactElement } from 'react';

import { webSpeech, type ReadAloud } from '@/app/(site)/_components/read-aloud';
import { CHIP } from '@/app/(site)/_components/story-actions';

/** One reader for the page, so starting one story stops the last. */
let shared: ReadAloud | null | undefined;

/** The page's reader, made on first use. */
function browserReader(): ReadAloud | null {
  if (shared === undefined) shared = webSpeech(window);
  return shared;
}

/** Speech support never changes while the page is open. */
function subscribe(): () => void {
  return () => undefined;
}

/**
 * "Listen" on a story: reads its headline and excerpt aloud, and stops on a
 * second press. It renders nothing on the server or where the browser cannot
 * speak.
 */
export function ListenButton({
  text,
  title,
}: Readonly<{ text: string; title: string }>): ReactElement | null {
  // Support is only known in the browser, so the server renders no button.
  const reader = useSyncExternalStore(subscribe, browserReader, () => null);
  const [playing, setPlaying] = useState(false);

  if (!reader) return null;
  return (
    <button
      type="button"
      className={CHIP}
      data-action="listen"
      aria-pressed={playing}
      aria-label={`${playing ? 'Stop reading' : 'Listen to'} ${title}`}
      onClick={() => {
        if (playing) {
          reader.stop();
          setPlaying(false);
        } else {
          reader.play(text, () => setPlaying(false));
          setPlaying(true);
        }
      }}
    >
      {playing ? '■ Stop' : '▶ Listen'}
    </button>
  );
}
