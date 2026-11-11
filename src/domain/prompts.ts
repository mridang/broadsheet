/**
 * @packageDocumentation
 *
 * NewsBlur's AI prompt classifiers: a person writes what they want more or
 * less of in their own words, and Workers AI is asked, story by story, whether
 * each matches. Every answer is kept, so a story is asked about once per
 * prompt; the paper then reads the kept answers (see `verdict`).
 */

import type { Feed, Repository } from '@/domain/repository';
import { budget } from '@/domain/api/usage';
import { logWarn } from '@/utils/logging';

/** The model that judges stories against a prompt. */
export const PROMPT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

/** The most stories one prompt is asked about in one run. */
export const PROMPT_BATCH = 50;

/** How much of a story's summary the model reads. */
const SUMMARY_CHARS = 600;

/** What the model is told before each story. */
const SYSTEM =
  'You sort news stories for a reader. Given what the reader asked for and one story, answer with the single word yes when the story matches it, otherwise no.';

/** The question asked about one story. */
export function promptQuestion(
  prompt: string,
  story: { readonly title: string | null; readonly summary: string | null },
): string {
  return `The reader asked for: ${prompt}\n\nStory: ${story.title ?? ''}\n${(
    story.summary ?? ''
  ).slice(0, SUMMARY_CHARS)}\n\nDoes the story match? Answer yes or no.`;
}

/** The model's answer read as a match, or undefined when it gave none. */
export function readAnswer(out: unknown): boolean | undefined {
  const text = (out as { response?: unknown } | null)?.response;
  if (typeof text !== 'string') return undefined;
  if (/^\W*yes\b/i.test(text)) return true;
  if (/^\W*no\b/i.test(text)) return false;
  return undefined;
}

/**
 * Ask the model whether one story matches `prompt`: true or false, or
 * undefined when it gave no answer. Throws when the model cannot be reached.
 */
export async function askPrompt(
  ai: Pick<Ai, 'run'>,
  prompt: string,
  story: { readonly title: string | null; readonly summary: string | null },
): Promise<boolean | undefined> {
  const out = await ai.run(PROMPT_MODEL, {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: promptQuestion(prompt, story) },
    ],
    max_tokens: 3,
  });
  return readAnswer(out);
}

/** Whether a classifier's scope reaches a feed. */
function reaches(
  c: {
    readonly scope_feed_id: number | null;
    readonly scope_section_id: number | null;
  },
  feed: Feed | undefined,
): boolean {
  if (!feed) return false;
  if (c.scope_feed_id !== null) return feed.id === c.scope_feed_id;
  if (c.scope_section_id !== null) {
    return feed.section_ids.includes(c.scope_section_id);
  }
  return true;
}

/**
 * Ask the model about the person's stories in `edition` that their prompt
 * classifiers have not judged yet, and keep the answers (a story outside a
 * prompt's scope is kept as no match without asking). A story the model gave no answer for is asked again next
 * time. Stops at the person's daily AI classifier budget. The number of
 * questions asked.
 */
export async function scorePrompts(
  env: CloudflareEnv,
  repo: Repository,
  userId: number,
  edition: string,
): Promise<number> {
  const pending = await repo.unscoredPrompts(userId, edition, PROMPT_BATCH);
  if (pending.length === 0) return 0;
  // NewsBlur stops classifying at the person's spending limit; so do we.
  const quota = await budget(repo, userId, 'classifier');
  let left = quota.remaining;
  const feeds = await repo.listFeeds(userId);
  const bySource = new Map(feeds.map((f) => [f.source_id, f]));
  let asked = 0;
  for (const { classifier, stories } of pending) {
    const answers = new Map<number, boolean>();
    for (const story of stories) {
      if (!reaches(classifier, bySource.get(story.source_id))) {
        // Out of the prompt's scope never matches; kept so it is not asked.
        answers.set(story.id, false);
      } else if (left <= 0) {
        break;
      } else {
        left -= 1;
        asked += 1;
        await askAndRecord(env, repo, userId, classifier.value, story, answers);
      }
    }
    await repo.savePromptScores(userId, classifier.id, answers);
  }
  return asked;
}

/** Records a prompt's answer, unless the model gave none. */
function recordAnswer(
  answers: Map<number, boolean>,
  storyId: number,
  matched: boolean | undefined = undefined,
): void {
  if (matched !== undefined) answers.set(storyId, matched);
}

/** Asks the model about one story and keeps its answer; a failure is logged and the story left for next time. */
async function askAndRecord(
  env: CloudflareEnv,
  repo: Repository,
  userId: number,
  question: string,
  story: Parameters<typeof askPrompt>[2] & { readonly id: number },
  answers: Map<number, boolean>,
): Promise<void> {
  try {
    const matched = await askPrompt(env.AI, question, story);
    recordAnswer(answers, story.id, matched);
    await repo.recordUsage(userId, 'classifier');
  } catch (error) {
    logWarn({
      event: 'prompt.failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
