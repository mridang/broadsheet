import { describe, expect, it } from '@jest/globals';

import { Toast } from '@/components/ui/toast';
import { html } from '../render';

describe('Toast', () => {
  it('is a polite live region that is there before any message', () => {
    const out = html(<Toast />);
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-live="polite"');
  });

  it('stays off the printout', () => {
    expect(html(<Toast message="Saved" />)).toContain('print:hidden');
  });
});
