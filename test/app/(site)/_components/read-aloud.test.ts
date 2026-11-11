import { describe, expect, it, jest } from '@jest/globals';

import { spokenText, webSpeech } from '@/app/(site)/_components/read-aloud';

class FakeUtterance {
  private readonly listeners = new Map<
    string,
    ((event: { charIndex: number }) => void)[]
  >();
  rate = 1;
  constructor(readonly text: string) {}
  addEventListener(
    type: string,
    listener: (event: { charIndex: number }) => void,
  ): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string, charIndex = 0): void {
    for (const listener of this.listeners.get(type) ?? [])
      listener({ charIndex });
  }
}

function host() {
  const spoken: FakeUtterance[] = [];
  const synth = {
    speak: jest.fn((u: FakeUtterance) => {
      spoken.push(u);
    }),
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
    spoken[0]?.fire('end');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ignores the late end of a cancelled reading once it restarts', () => {
    const { host: h, spoken } = host();
    const reader = webSpeech(h);
    const onEnd = jest.fn();
    reader?.play('One', onEnd);
    reader?.stop();
    reader?.play('One', onEnd);
    onEnd.mockClear();
    spoken[0]?.fire('error');
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('ends the story being read when another starts', () => {
    const { host: h } = host();
    const reader = webSpeech(h);
    const first = jest.fn();
    reader?.play('One', first);
    reader?.play('Two', () => undefined);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('says a reading completed only when it came to its end', () => {
    const { host: h, spoken } = host();
    const reader = webSpeech(h);
    const ends: boolean[] = [];
    reader?.play('One', (done) => ends.push(done));
    spoken[0]?.fire('end');
    reader?.play('Two', (done) => ends.push(done));
    spoken[1]?.fire('error');
    reader?.play('Three', (done) => ends.push(done));
    reader?.stop();
    expect(ends).toEqual([true, false, false]);
  });

  it('reads at the rate asked, from where it left off', () => {
    const { host: h, spoken } = host();
    webSpeech(h)?.play('Hello world', () => undefined, { rate: 1.5, from: 6 });
    expect(spoken[0]?.text).toBe('world');
    expect(spoken[0]?.rate).toBe(1.5);
  });

  it('starts from the top for a position outside the text', () => {
    const { host: h, spoken } = host();
    webSpeech(h)?.play('Hello', () => undefined, { from: 99 });
    expect(spoken[0]?.text).toBe('Hello');
  });

  it('reports progress through the whole text', () => {
    const { host: h, spoken } = host();
    const seen: number[] = [];
    webSpeech(h)?.play('Hello world', () => undefined, {
      from: 6,
      onProgress: (at) => seen.push(at),
    });
    spoken[0]?.fire('boundary', 2);
    expect(seen).toEqual([8]);
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
