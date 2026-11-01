import { describe, expect, it } from '@jest/globals';

import { Badge, Chip, CHIP } from '@/components/ui/badge';
import { classOf, html } from '../render';

describe('Badge', () => {
  it('is a quiet neutral label by default', () => {
    expect(classOf(html(<Badge>3</Badge>), 'span')).toContain('text-muted');
  });

  it('takes its colours from the tone', () => {
    expect(
      classOf(html(<Badge tone="danger">Failing</Badge>), 'span'),
    ).toContain('text-danger');
    expect(classOf(html(<Badge tone="success">Live</Badge>), 'span')).toContain(
      'text-success',
    );
  });
});

describe('Chip', () => {
  it('is a button that never submits a form', () => {
    expect(html(<Chip>Tag</Chip>)).toContain('type="button"');
  });

  it('shows when it is pressed', () => {
    const out = html(<Chip aria-pressed>Tag</Chip>);
    expect(out).toContain('aria-pressed="true"');
    expect(CHIP).toContain('aria-pressed:text-accent');
  });
});
