import { describe, expect, it } from '@jest/globals';

import { InstallButton } from '@/components/site/install-button';
import { html } from '../render';

describe('InstallButton', () => {
  // Rendered on the server there is no browser to ask: nothing is offered until
  // the browser says the app can be installed, and the iOS tip is never shown
  // there (see install-ios-hint.test.tsx).
  it('offers no button until the browser says the app can be installed', () => {
    expect(html(<InstallButton />)).not.toContain('<button');
  });

  it('keeps the bar the masthead styles, and a card for the iOS tip that hides while empty', () => {
    const out = html(<InstallButton />);
    expect(out).toContain('class="installbar"');
    expect(out).toContain('empty:hidden');
  });
});
