'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** PWA install affordance — Chrome no longer auto-prompts. */
export function InstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );

  useEffect(() => {
    const onPrompt = (e: Event): void => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const install = async (): Promise<void> => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  return (
    <div className="installbar">
      <button className="install" hidden={!deferred} onClick={install}>
        ⬇ Install app
      </button>
    </div>
  );
}
