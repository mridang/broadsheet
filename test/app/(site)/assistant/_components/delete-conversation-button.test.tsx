import { describe, expect, it } from '@jest/globals';

import { DeleteConversationButton } from '@/app/(site)/assistant/_components/delete-conversation-button';
import { html } from '../../../../components/render';

describe('DeleteConversationButton', () => {
  it('is a button that acts on the page', () => {
    expect(html(<DeleteConversationButton id="3" />)).toMatch(
      /<button type="button" class="[^"]*">Delete<\/button>/,
    );
  });
});
