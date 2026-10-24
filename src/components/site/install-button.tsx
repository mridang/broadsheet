'use client';

import type { ReactElement } from 'react';

import { InstallIosHint } from '@/components/site/install-ios-hint';
import { useInstallPrompt } from '@/components/site/use-install-prompt';

/**
 * "Install app" in the masthead: shown only where the browser can install the
 * app (Chrome and Edge, until it is installed), with the "Add to Home Screen"
 * tip beneath it for Safari on an iPhone or iPad, which has no install button
 * to offer. The tip is drawn on a card of the page colour, as the masthead is
 * coloured and the tip is not; the card is hidden while the tip is not shown.
 */
export function InstallButton(): ReactElement {
  const { install } = useInstallPrompt();
  return (
    <div className="installbar">
      {install ? (
        <button
          type="button"
          className="install"
          onClick={() => void install()}
        >
          ⬇ Install app
        </button>
      ) : null}
      <div className="mx-auto max-w-sm rounded-control bg-paper text-ink empty:hidden">
        <InstallIosHint />
      </div>
    </div>
  );
}
