import { describe, expect, it } from '@jest/globals';

import { EditionSwitcher } from '@/app/(site)/_components/edition-switcher';
import { html } from '../../../components/render';

describe('EditionSwitcher', () => {
  it('marks the daily paper when no custom edition shows', () => {
    const out = html(<EditionSwitcher editions={[]} />);
    expect(out).toMatch(
      /<a class="[^"]*" href="\/" aria-current="page">Daily<\/a>/,
    );
    expect(out).toContain('href="/editions"');
  });

  it('links each custom edition and marks the one showing', () => {
    const out = html(
      <EditionSwitcher
        editions={[
          { id: 4, name: 'Weekend' },
          { id: 5, name: 'Rust' },
        ]}
        selected={5}
      />,
    );
    expect(out).toMatch(/href="\/\?edition=4">Weekend<\/a>/);
    expect(out).toContain('href="/?edition=5" aria-current="page">Rust</a>');
    expect(out).toContain('href="/">Daily</a>');
  });
});
