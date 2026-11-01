import { describe, expect, it } from '@jest/globals';

import { Dialog } from '@/components/ui/dialog';
import { html } from '../render';

describe('Dialog', () => {
  const out = html(
    <Dialog
      open={false}
      onClose={() => undefined}
      title="Remove feed"
      description="Its stories go too."
      footer={<button>Remove</button>}
    >
      Sure?
    </Dialog>,
  );

  it('is a native dialog named by its title', () => {
    expect(out).toMatch(/^<dialog aria-label="Remove feed"/);
    expect(out).toContain('Its stories go too.');
  });

  it('has a labelled close button and the caller’s buttons', () => {
    expect(out).toContain('aria-label="Close"');
    expect(out).toContain('<button>Remove</button>');
  });
});
