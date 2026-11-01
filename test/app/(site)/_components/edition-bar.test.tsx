import { describe, expect, it } from '@jest/globals';

import { EditionBar } from '@/app/(site)/_components/edition-bar';
import { html } from '../../../components/render';

const days = ['2026-11-03', '2026-11-02', '2026-11-01'];

describe('EditionBar', () => {
  it('pages to the day before and after', () => {
    const out = html(<EditionBar selected="2026-11-02" editions={days} />);
    expect(out).toContain(
      'href="/edition/2026-11-01" aria-label="Previous day"',
    );
    expect(out).toContain('href="/edition/2026-11-03" aria-label="Next day"');
  });

  it('has no next day on the newest issue', () => {
    const out = html(<EditionBar selected="2026-11-03" editions={days} />);
    expect(out).not.toContain('aria-label="Next day"');
  });

  it('lists the archive and marks the day showing', () => {
    const out = html(<EditionBar selected="2026-11-02" editions={days} />);
    expect(out).toContain('aria-label="Browse the archive"');
    expect(out).toContain('href="/edition/2026-11-02" aria-current="page"');
  });

  it('has no archive with a single issue', () => {
    expect(
      html(<EditionBar selected="2026-11-03" editions={['2026-11-03']} />),
    ).not.toContain('Browse the archive');
  });
});
