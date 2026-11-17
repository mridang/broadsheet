import { describe, expect, it } from '@jest/globals';

import { Dialog } from '@/components/ui/dialog';
import { html } from '../render';

const IS_A_NATIVE_DIALOG_PATTERN = /^<dialog aria-label="Remove feed"/u;

describe('Dialog', () => {
  const out = html(
    <Dialog
      open={false}
      onClose={() => undefined}
      title="Remove feed"
      description="Its stories go too."
      footer={<button type="button">Remove</button>}
    >
      Sure?
    </Dialog>,
  );

  it('is a native dialog named by its title', () => {
    expect(out).toMatch(IS_A_NATIVE_DIALOG_PATTERN);
    expect(out).toContain('Its stories go too.');
  });

  it('has a labelled close button and the caller’s buttons', () => {
    expect(out).toContain('aria-label="Close"');
    expect(out).toContain('<button type="button">Remove</button>');
  });
});
