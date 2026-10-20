import { describe, expect, it } from '@jest/globals';

import { InstallIosHint } from '../../../src/components/site/install-ios-hint';
import { html } from '../render';

describe('InstallIosHint', () => {
  // Rendered on the server there is no browser to ask, so it is never shown
  // there: the first client render agrees, then the browser's own answer
  // (see ios-install.test.ts) decides.
  it('renders nothing on the server', () => {
    expect(html(<InstallIosHint />)).toBe('');
  });
});
