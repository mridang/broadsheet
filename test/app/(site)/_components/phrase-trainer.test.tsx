import { describe, expect, it } from '@jest/globals';

import { PhraseTrainer } from '@/app/(site)/_components/phrase-trainer';
import { html } from '../../../components/render';

describe('PhraseTrainer', () => {
  const out = html(<PhraseTrainer title="Why Rust" />);

  it('starts the phrase at the story’s title', () => {
    expect(out).toContain('value="Why Rust"');
  });

  it('offers every kind a phrase can match, Ask AI included', () => {
    ['title', 'text', 'url', 'author', 'prompt'].forEach((kind) =>
      expect(out).toContain(`value="${kind}"`),
    );
  });

  it('offers a regular expression and three scores', () => {
    expect(out).toContain('Regex');
    ['👍', '👎', '🚫'].forEach((label) =>
      expect(out).toMatch(
        new RegExp(`<button type="button"[^>]*>${label}</button>`),
      ),
    );
  });
});
