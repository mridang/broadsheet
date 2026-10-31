import { describe, expect, it } from '@jest/globals';

import { AssistantChat } from '@/app/(site)/assistant/_components/assistant-chat';
import { html } from '../../../../components/render';

describe('AssistantChat', () => {
  it('starts with a question box that posts nowhere by itself', () => {
    const out = html(<AssistantChat />);
    expect(out).toContain('name="content"');
    expect(out).toContain('>Ask</button>');
    expect(out).not.toContain('action=');
  });
});
