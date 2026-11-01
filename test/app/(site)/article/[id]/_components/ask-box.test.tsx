import { describe, expect, it } from '@jest/globals';

import { AskBox } from '@/app/(site)/article/[id]/_components/ask-box';
import { PRESET_QUESTIONS } from '@/domain/assistant';
import { html } from '../../../../../components/render';

describe('AskBox', () => {
  it('offers the preset questions as buttons', () => {
    const out = html(<AskBox id={4} />);
    for (const preset of PRESET_QUESTIONS) {
      expect(out).toContain(`>${preset.label}</button>`);
    }
  });

  it('has a box for the reader’s own question that posts nowhere by itself', () => {
    const out = html(<AskBox id={4} />);
    expect(out).toContain('name="question"');
    expect(out).not.toContain('action=');
  });
});
