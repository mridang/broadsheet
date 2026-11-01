import { describe, expect, it } from '@jest/globals';

import { ThemeScript } from '@/components/site/theme-script';

describe('ThemeScript', () => {
  it('draws nothing, as the app has no theme to apply before the first paint', () => {
    expect(ThemeScript()).toBeNull();
  });
});
