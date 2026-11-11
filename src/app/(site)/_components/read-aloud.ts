/**
 * Reading a story aloud, behind one small interface so the browser's own voice
 * can later give way to recorded audio (Workers AI speech, say, kept in R2)
 * without touching the button.
 */
export interface ReadAloud {
  /**
   * Starts reading `text`, stopping anything already being read: from
   * character `from` on, at `rate` (1 is normal), telling `onProgress` how far
   * it has got. `onEnd` says whether the reading came to its end (true) or
   * was stopped or failed.
   */
  play(
    text: string,
    onEnd: (completed: boolean) => void,
    options?: PlayOptions,
  ): void;
  /** Stops reading. */
  stop(): void;
}

/** How a reading starts and reports. */
export type PlayOptions = Readonly<{
  rate?: number;
  from?: number;
  onProgress?: (position: number) => void;
}>;

/** The part of the Web Speech API this module uses. */
export type SpeechHost = Readonly<{
  speechSynthesis?: Pick<SpeechSynthesis, 'speak' | 'cancel'>;
  SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance;
}>;

/** A reader using the browser's speech synthesis, or `null` where it has none. */
export function webSpeech(host: SpeechHost): ReadAloud | null {
  const synth = host.speechSynthesis;
  const Utterance = host.SpeechSynthesisUtterance;
  if (!synth || !Utterance) return null;
  // What is being read now. The browser ends a cancelled utterance a moment
  // later, so a stale end is ignored rather than stopping the next one.
  let active: {
    utterance: SpeechSynthesisUtterance;
    onEnd: (completed: boolean) => void;
  } | null = null;
  const finish = (utterance?: SpeechSynthesisUtterance, completed = false) => {
    if (!active || (utterance && active.utterance !== utterance)) return;
    const { onEnd } = active;
    active = null;
    onEnd(completed);
  };
  return {
    play(text, onEnd, { rate = 1, from = 0, onProgress } = {}) {
      finish();
      synth.cancel();
      const start = from > 0 && from < text.length ? from : 0;
      const utterance = new Utterance(text.slice(start));
      utterance.rate = rate;
      if (onProgress) {
        utterance.onboundary = (event) => onProgress(start + event.charIndex);
      }
      utterance.onend = () => finish(utterance, true);
      // eslint-disable-next-line unicorn/prefer-add-event-listener -- the speech fake and the sibling handlers assign on* properties
      utterance.onerror = () => finish(utterance);
      active = { utterance, onEnd };
      synth.speak(utterance);
    },
    stop() {
      finish();
      synth.cancel();
    },
  };
}

/** What is read for a story: its headline, then its excerpt. */
export function spokenText(title: string, excerpt: string): string {
  return [title, excerpt]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('. ');
}
