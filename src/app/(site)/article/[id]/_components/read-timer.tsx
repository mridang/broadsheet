'use client';

import { useEffect } from 'react';

import {
  markRead,
  recordReadTime,
} from '@/app/(site)/_components/story-requests';

/** Time kept in view, counted across the page being hidden and shown. */
export interface ReadClock {
  /** The page came into view at `now` (milliseconds). */
  show(now: number): void;
  /** The page left view at `now`; the whole seconds in view so far. */
  hide(now: number): number;
}

/** A clock that starts in view at `now` when `visible`. */
export function readClock(visible: boolean, now: number): ReadClock {
  let shown = visible ? now : null;
  let spent = 0;
  return {
    show(at) {
      shown ??= at;
    },
    hide(at) {
      if (shown !== null) spent += at - shown;
      shown = null;
      return Math.round(spent / 1000);
    },
  };
}

/**
 * Notes the story as read when its page opens, and how long the reader kept
 * it in view each time they hide or leave it, so trending can rank the
 * stories people read through. Renders nothing.
 */
export function ReadTimer({ id }: Readonly<{ id: number }>): null {
  useEffect(() => {
    markRead(id);
    const clock = readClock(document.visibilityState === 'visible', Date.now());
    function onChange() {
      if (document.visibilityState === 'visible') clock.show(Date.now());
      else recordReadTime(id, clock.hide(Date.now()));
    }
    function onLeave() {
      recordReadTime(id, clock.hide(Date.now()));
    }
    document.addEventListener('visibilitychange', onChange);
    window.addEventListener('pagehide', onLeave);
    return () => {
      document.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('pagehide', onLeave);
    };
  }, [id]);
  return null;
}
