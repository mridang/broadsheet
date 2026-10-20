'use client';

import { useCallback, useEffect, useState } from 'react';

/** Chrome's install prompt event, which TypeScript's DOM types don't include. */
/** The install prompt event: Chrome's `beforeinstallprompt`. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Whether an event is Chrome's install prompt: the one that carries a `prompt` method. */
export function isInstallPromptEvent(
  event: Event,
): event is InstallPromptEvent {
  return 'prompt' in event && typeof event.prompt === 'function';
}

/**
 * Show the browser's install prompt and wait for the person's answer. Either
 * answer uses the event up (a prompt can be shown once), so the caller drops it.
 */
export async function runInstall(event: InstallPromptEvent): Promise<void> {
  await event.prompt();
  await event.userChoice;
}

/**
 * Lets the page offer "Install app" when the browser says the site can be
 * installed. `install` is undefined until then (and after it has been used, or
 * when the app is already installed), so callers show the option only when it
 * works. Chrome and Edge fire the event; Safari has its own Share menu route.
 */
export function useInstallPrompt(): Readonly<{
  install?: () => Promise<void>;
}> {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      if (!isInstallPromptEvent(e)) {
        return;
      }
      // Hold the prompt back until the person asks for it, rather than letting
      // the browser show its own mini-infobar.
      e.preventDefault();
      setEvent(e);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!event) {
      return;
    }
    await runInstall(event);
    setEvent(null);
  }, [event]);

  return event ? { install } : {};
}
