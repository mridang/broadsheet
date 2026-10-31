/**
 * @packageDocumentation
 *
 * Issues on the wire: the representation `/api/editions/self/issues/{date}`
 * sends for one day's paper.
 */

import type { Issue } from '@/domain/issues';
import type { Tier } from '@/domain/render/tiers';

/** One story as the issue prints it. */
export interface IssueStoryResource {
  readonly article_id: string;
  readonly tier: Tier;
  readonly also_covered_by: readonly string[];
}

/** One feed's desk in the issue. */
export interface IssueDeskResource {
  readonly feed_id: string;
  readonly title: string;
  readonly url: string;
  readonly stories: readonly IssueStoryResource[];
}

/** A section of the issue; the unfiled desks come in one with no name. */
export interface IssueSectionResource {
  readonly name?: string;
  readonly desks: readonly IssueDeskResource[];
}

/** One day's paper. Absent members are unknown, never null. */
export interface IssueResource {
  readonly date: string;
  readonly briefing?: string;
  readonly sections: readonly IssueSectionResource[];
  readonly created_at?: string;
}

/** The API's view of an issue. */
export function issueResource(issue: Readonly<Issue>): IssueResource {
  const created = issue.created_at
    ? Date.parse(`${issue.created_at.replace(' ', 'T')}Z`)
    : Number.NaN;
  return {
    date: issue.date,
    ...(issue.briefing ? { briefing: issue.briefing } : {}),
    sections: issue.layout.groups.map((group) => ({
      ...(group.name ? { name: group.name } : {}),
      desks: group.desks.map((desk) => ({
        feed_id: String(desk.feed_id),
        title: desk.title,
        url: desk.url,
        stories: desk.stories.map((story) => ({
          article_id: String(story.id),
          tier: story.tier,
          also_covered_by: story.also,
        })),
      })),
    })),
    ...(Number.isNaN(created)
      ? {}
      : { created_at: new Date(created).toISOString() }),
  };
}
