import { describe, expect, it } from '@jest/globals';

import { VoiceButton } from '@/app/(site)/article/[id]/_components/voice-button';
import { html } from '../../../../../components/render';

describe('VoiceButton', () => {
  it('renders nothing until the browser is known to record', () => {
    expect(html(<VoiceButton onText={() => undefined} />)).toBe('');
  });
});
