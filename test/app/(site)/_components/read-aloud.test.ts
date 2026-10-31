import { describe, expect, it, jest } from '@jest/globals';

import { spokenText, webSpeech } from '@/app/(site)/_components/read-aloud';

class FakeUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

function host() {
  const spoken: FakeUtterance[] = [];
  const synth = {
    speak: jest.fn((u: FakeUtterance) => void spoken.push(u)),
    cancel: jest.fn(),
  };
  return {
    spoken,
    synth,
    host: {
      speechSynthesis: synth,
      SpeechSynthesisUtterance: FakeUtterance,
    } as never,
  };
}

describe('webSpeech', () => {
  it('is null where the browser cannot speak', () => {
    expect(webSpeech({})).toBeNull();
    expect(webSpeech({ speechSynthesis: host().synth } as never)).toBeNull();
  });

  it('stops what is being read before reading the new text', () => {
    const { host: h, synth, spoken } = host();
    webSpeech(h)?.play('Hello', () => undefined);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(spoken.map((u) => u.text)).toEqual(['Hello']);
  });

  it('says when reading ends or fails', () => {
    const { host: h, spoken } = host();
    const onEnd = jest.fn();
    webSpeech(h)?.play('Hello', onEnd);
    spoken[0]?.onend?.();
    spoken[0]?.onerror?.();
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it('stops by cancelling the speech', () => {
    const { host: h, synth } = host();
    webSpeech(h)?.stop();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });
});

describe('spokenText', () => {
  it('reads the headline, then the excerpt', () => {
    expect(spokenText('Title', 'Body text')).toBe('Title. Body text');
  });

  it('reads only the headline when there is no excerpt', () => {
    expect(spokenText(' Title ', '')).toBe('Title');
  });
});
