'use client';

import {
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';

import { transcribeAudio } from '@/app/(site)/article/[id]/_components/answer-requests';
import { useApiAction } from '@/components/api/use-api-action';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';

/** Whether a browser can record never changes, so nothing is subscribed. */
function noChanges(): () => void {
  return () => undefined;
}

/**
 * Ask by voice: the first press records from the microphone, the second stops
 * and hands what was said (transcribed by the server) to `onText`. Shows
 * nothing until the page knows the browser can record.
 */
export function VoiceButton({
  onText,
  disabled,
}: Readonly<{
  onText: (text: string) => void;
  disabled?: boolean;
}>): ReactElement | null {
  const { busy, error, run } = useApiAction();
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  // False on the server and while hydrating, so both render the same.
  const supported = useSyncExternalStore(
    noChanges,
    () => 'MediaRecorder' in window,
    () => false,
  );
  if (!supported) return null;
  const start = async (): Promise<void> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (event) => chunks.push(event.data);
    rec.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const audio = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      void run(
        async () => onText(await transcribeAudio(audio)),
        'Could not hear that.',
      );
    };
    rec.start();
    recorder.current = rec;
    setRecording(true);
  };
  const toggle = (): void => {
    if (recording) {
      recorder.current?.stop();
      setRecording(false);
    } else {
      void start().catch(() => setRecording(false));
    }
  };
  return (
    <>
      <button
        type="button"
        className={buttonClass({ variant: 'outline' })}
        disabled={disabled || busy}
        aria-pressed={recording}
        onClick={toggle}
      >
        {recording ? 'Stop' : busy ? 'Listening…' : 'Speak'}
      </button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
