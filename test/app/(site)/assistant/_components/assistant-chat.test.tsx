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

  it('offers the suggested questions before the first turn', () => {
    const out = html(<AssistantChat suggestions={['What is new?']} />);
    expect(out).toContain('>What is new?</button>');
  });

  it('shows the turns of a reopened conversation, not the suggestions', () => {
    const out = html(
      <AssistantChat
        conversationId="3"
        suggestions={['What is new?']}
        initialTurns={[
          {
            id: '1',
            role: 'assistant',
            content: 'An answer',
            citations: [{ article_id: '4', title: 'Four', href: '/article/4' }],
          },
        ]}
      />,
    );
    expect(out).toContain('An answer');
    expect(out).toContain('href="/article/4"');
    expect(out).not.toContain('What is new?');
  });
});
