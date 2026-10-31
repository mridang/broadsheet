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
  return {
    play(text, onEnd) {
      synth.cancel();
      const utterance = new Utterance(text);
      utterance.onend = onEnd;
      utterance.onerror = onEnd;
      synth.speak(utterance);
    },
    stop() {
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
