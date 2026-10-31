import { describe, expect, it } from '@jest/globals';

import { AskBox } from '@/app/(site)/article/[id]/_components/ask-box';
import { html } from '../../../../../components/render';

describe('AskBox', () => {
  it('offers the preset questions as buttons', () => {
    const out = html(<AskBox id={4} />);
    expect(out).toContain('>Summarise</button>');
    expect(out).toContain('>Explain</button>');
    expect(out).toContain('>The other side</button>');
  });

  it('has a box for the reader’s own question that posts nowhere by itself', () => {
    const out = html(<AskBox id={4} />);
    expect(out).toContain('name="question"');
    expect(out).not.toContain('action=');
  });
});
