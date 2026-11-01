'use client';

import { useEffect, useState, type ReactElement } from 'react';

import { cn } from '@/components/ui/cn';

/** How long a toast stays up, in milliseconds. */
const SHOW_FOR = 4000;

/**
 * A short message that confirms an action ("Saved", "Copied") at the bottom
 * of the screen and goes away by itself. A screen reader reads it out. Pass a
 * new `message` (or the same one with a new `nonce`) to show it again.
 */
export function Toast({
  message,
  nonce = 0,
  tone = 'neutral',
}: Readonly<{
  message?: string;
  nonce?: number;
  tone?: 'neutral' | 'danger';
}>): ReactElement {
  const key = `${nonce}:${message ?? ''}`;
  const [expired, setExpired] = useState<string>();
  const shown = message && expired !== key ? message : undefined;

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setExpired(key), SHOW_FOR);
    return () => clearTimeout(timer);
  }, [message, key]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 print:hidden"
    >
      {shown ? (
        <p
          className={cn(
            'pointer-events-auto rounded-full px-4 py-2 text-sm font-medium shadow-overlay',
            tone === 'danger' ? 'bg-danger text-white' : 'bg-ink text-on-ink',
          )}
        >
          {shown}
        </p>
      ) : null}
    </div>
  );
}
