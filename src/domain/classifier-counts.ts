/**
 * @packageDocumentation
 *
 * How a feed's unread stories split under the person's training, as
 * NewsBlur's per-feed counts do: focus (liked), neutral, and hidden
 * (disliked), each decided by the same verdict the paper uses.
 */

import { verdict } from '@/domain/render/tiers';
import type { Classifiable, Training } from '@/domain/render/tiers';
import type { Article, Feed, Repository } from '@/domain/repository';

/** A feed's unread stories by verdict. */
export interface ClassifierCounts {
  readonly focus: number;
  readonly neutral: number;
  readonly hidden: number;
}

/** Count `stories` as focus, neutral or hidden under `training`. */
export function countVerdicts(
  stories: readonly Classifiable[],
  training: readonly Training[],
): ClassifierCounts {
  const scores = stories.map((story) => verdict(story, training));
  return {
    focus: scores.filter((score) => score > 0).length,
    neutral: scores.filter((score) => score === 0).length,
    hidden: scores.filter((score) => score < 0).length,
  };
}

/** A feed's stories, marked with what verdicts read, counted by verdict. */
export function feedVerdictCounts(
  stories: readonly Article[],
  feed: Pick<Feed, 'id' | 'section_id'>,
  training: readonly Training[],
  prompted: ReadonlyMap<number, ReadonlySet<number>>,
): ClassifierCounts {
  return countVerdicts(
    stories.map((story) => {
      const ids = prompted.get(story.id);
      return {
        ...story,
        feed_id: feed.id,
        section_id: feed.section_id,
        ...(ids ? { prompt_ids: ids } : {}),
      };
    }),
    training,
  );
}

/** The person's unread stories in one of their feeds, by verdict. */
export async function feedClassifierCounts(
  repo: Repository,
  userId: number,
  feed: Pick<Feed, 'id' | 'source_id' | 'section_id'>,
): Promise<ClassifierCounts> {
  const [stories, training, prompted] = await Promise.all([
    repo.unreadSourceArticles(userId, feed.source_id),
    repo.listClassifiers(userId),
    repo.promptMatches(userId),
  ]);
  return feedVerdictCounts(stories, feed, training, prompted);
}
