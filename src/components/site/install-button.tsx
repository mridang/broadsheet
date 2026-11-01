'use client';

import type { ReactElement } from 'react';

import { buttonClass } from '@/components/ui/button';
import { InstallIosHint } from '@/components/site/install-ios-hint';
import { useInstallPrompt } from '@/components/site/use-install-prompt';

/**
 * "Install app" in the masthead: shown only where the browser can install the
 * app (Chrome and Edge, until it is installed), with the "Add to Home Screen"
 * tip beneath it for Safari on an iPhone or iPad, which has no install button
 * to offer. The tip is drawn on a card of the page colour, as the masthead is
 * coloured and the tip is not; the card is hidden while the tip is not shown.
 * `look="app"` is the same, set for the app's sidebar instead.
 */
export function InstallButton({
  look = 'mast',
}: Readonly<{ look?: 'mast' | 'app' }>): ReactElement {
  const { install } = useInstallPrompt();
  if (look === 'app') {
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
