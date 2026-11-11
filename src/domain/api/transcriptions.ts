/**
 * @packageDocumentation
 *
 * Spoken questions, after NewsBlur's Ask AI voice input:
 * `POST /api/transcriptions` takes a recording (an `audio/*` body) and
 * answers with its text, transcribed by Workers AI's Whisper, for the reader
 * to ask as a question. A transcription is not kept. It counts against its
 * own daily budget, and the edge counts it as a model call (`RL_AI`).
 */

import {
  AnswerUnavailableError,
  MAX_AUDIO_BYTES,
  transcribe,
} from '@/domain/assistant';
import { answerModel, assistantUnavailable } from '@/domain/api/answers';
import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { overBudget } from '@/domain/api/usage';
import { ApiController, ok, problem, problems } from '@/lib/core/api';
import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';

/** What a recording was heard to say. */
export interface TranscriptionResource {
  readonly text: string;
}

/** The 413 for a recording over {@link MAX_AUDIO_BYTES}. */
function tooLarge(): Response {
  return problem(
    413,
    '/problems/too-large',
    'Content too large',
    `Send a recording of at most ${MAX_AUDIO_BYTES / 1024 / 1024} MB.`,
  );
}

/** Read the recording from the body, or throw the 4xx. */
export async function readAudio(request: Request): Promise<Uint8Array> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!type.startsWith('audio/')) {
    throw problems.unsupportedMediaType('audio (audio/webm, audio/mpeg, …)');
  }
  const announced = Number(request.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > MAX_AUDIO_BYTES) {
    throw tooLarge();
  }
  const audio = new Uint8Array(await request.arrayBuffer());
  if (audio.length > MAX_AUDIO_BYTES) throw tooLarge();
  if (audio.length === 0) {
    throw problems.badRequest('The recording is empty.', ['body: empty.']);
  }
  return audio;
}

/**
 * `POST /api/transcriptions` (an `audio/*` body): 200 with `{text}`. 400 for
 * an empty recording, 413 for one over 10 MB, 415 for a body that is not
 * audio, 429 when today's budget is used up, 502 when nothing could be heard
 * or the model fails, 401/403 when not signed in or cross-site.
 */
export function createTranscriptionsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<{ readonly uid: number }> {
  return new ApiController<{ readonly uid: number }>({
    context: async (request) => ({ uid: await liveUid(request, resolver) }),
  }).on<Uint8Array, TranscriptionResource | Response>({
    method: 'POST',
    decode: readAudio,
    handle: async (audio, { uid }) => {
      const repo = new Repository(getDatabase());
      const refusal = await overBudget(repo, uid, 'transcription');
      if (refusal) return refusal;
      try {
        const text = await transcribe(answerModel(), audio);
        await repo.recordUsage(uid, 'transcription');
        return { text };
      } catch (error) {
        if (error instanceof AnswerUnavailableError) {
          return assistantUnavailable(error);
        }
        throw error;
      }
    },
    encode: (result) =>
      result instanceof Response
        ? result
        : ok(result, { headers: { 'Cache-Control': 'no-store' } }),
  });
}

/** The transcriptions controller bound to the production resolver. */
export const transcriptionsCollection = createTranscriptionsCollection();
