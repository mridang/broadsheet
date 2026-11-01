/**
 * Reading a story aloud, behind one small interface so the browser's own voice
 * can later give way to recorded audio (Workers AI speech, say, kept in R2)
 * without touching the button.
 */
export interface ReadAloud {
  /** Starts reading `text`, stopping anything already being read. */
  play(text: string, onEnd: () => void): void;
  /** Stops reading. */
  stop(): void;
}

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
    onEnd: () => void;
  } | null = null;
  const finish = (utterance?: SpeechSynthesisUtterance) => {
    if (!active || (utterance && active.utterance !== utterance)) return;
    const { onEnd } = active;
    active = null;
    onEnd();
  };
  return {
    play(text, onEnd) {
      finish();
      synth.cancel();
      const utterance = new Utterance(text);
      utterance.onend = () => finish(utterance);
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
