'use client';

import type { ReactElement } from 'react';

import { buttonClass } from '@/components/ui/button';
import { InstallIosHint } from '@/components/site/install-ios-hint';
import { useInstallPrompt } from '@/components/site/use-install-prompt';

/**
 * "Install app" in the sidebar: shown only where the browser can install the
 * app (Chrome and Edge, until it is installed), with the "Add to Home Screen"
 * tip beneath it for Safari on an iPhone or iPad, which has no install button
 * to offer. The tip's card is hidden while the tip is not shown.
 */
export function InstallButton(): ReactElement {
  const { install } = useInstallPrompt();
  return (
    <div className="space-y-2">
      {install ? (
        <button
          type="button"
          className={buttonClass({
            variant: 'outline',
            size: 'sm',
            className: 'w-full border-line',
          })}
          onClick={() => void install()}
        >
          Install app
        </button>
      ) : null}
      <div className="rounded-card border border-line bg-surface text-ink empty:hidden">
        <InstallIosHint />
      </div>
    </div>
  );
}
