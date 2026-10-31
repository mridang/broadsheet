import { describe, expect, it } from '@jest/globals';

import { ListenButton } from '@/app/(site)/_components/listen-button';
import { html } from '../../../components/render';

describe('ListenButton', () => {
  it('renders nothing on the server, where speech support is unknown', () => {
    expect(html(<ListenButton title="A story" text="A story." />)).toBe('');
  });
});
