/**
 * @packageDocumentation
 *
 * Whether a notification rule matches a story, as NewsBlur's classifier
 * notifications decide: in the rule's scope (one feed, one section or every
 * feed), then a phrase found in the title, text or address, the same author,
 * one of the tags, a regular expression (case-insensitive) over the title,
 * author, text or address, or an AI prompt, which Workers AI judges (see
 * `notify`) rather than this module.
 *
 * NewsBlur stops a slow regular expression with a timer; a Worker has no
 * threads to do that with, so a pattern that can backtrack without end (a
 * quantifier on a group that already repeats, or a back-reference) is refused
 * when the rule is made, and the text it runs over is capped.
 */

import type { FollowedStory, NotificationRule } from '@/domain/notifications';

/** Longest pattern or phrase a rule may hold. */
export const MAX_RULE_LENGTH = 200;

/** The most text a regular expression runs over. */
const MAX_MATCHED_TEXT = 20_000;

/**
 * Why a pattern cannot be a rule, or undefined when it can: it must compile,
 * and it must not nest quantifiers or refer back to a group.
 */
export function regexProblem(pattern: string): string | undefined {
  if (pattern.length > MAX_RULE_LENGTH) return 'too long';
  try {
    new RegExp(pattern, 'i');
  } catch {
    return 'not a valid regular expression';
  }
  if (/\\[1-9]|\\k</.test(pattern)) return 'back-references are not allowed';
  if (/\([^)]*[+*}][^)]*\)\s*[+*{?]/.test(pattern)) {
    return 'a repeated group may not itself repeat';
  }
  return undefined;
}

/** The parts of a story a rule can look at. */
export type RuledStory = Pick<
  FollowedStory,
  'feed_id' | 'section_id' | 'title' | 'url' | 'summary' | 'body_text'
> & {
  readonly author?: string | null;
  readonly tags?: readonly string[];
};

/** Whether the story is in the rule's feed, section or anywhere. */
export function inScope(rule: NotificationRule, story: RuledStory): boolean {
  if (rule.scope === 'feed') return story.feed_id === rule.feed_id;
  if (rule.scope === 'section') return story.section_id === rule.section_id;
  return true;
}

/** Whether `text` matches the rule's value, as a phrase or a pattern. */
function found(rule: NotificationRule, text: string): boolean {
  if (!text) return false;
  if (!rule.is_regex)
    return text.toLowerCase().includes(rule.value.toLowerCase());
  if (regexProblem(rule.value)) return false;
  return new RegExp(rule.value, 'i').test(text.slice(0, MAX_MATCHED_TEXT));
}

/** Whether the rule matches the story. */
export function matchesRule(
  rule: NotificationRule,
  story: RuledStory,
): boolean {
  if (!inScope(rule, story)) return false;
  switch (rule.kind) {
    case 'title': {
      return found(rule, story.title ?? '');
    }
    case 'url': {
      return found(rule, story.url);
    }
    case 'text': {
      return found(
        rule,
        [story.summary, story.body_text].filter(Boolean).join(' '),
      );
    }
    case 'author': {
      return rule.is_regex
        ? found(rule, story.author ?? '')
        : !!story.author && story.author === rule.value;
    }
    case 'tag': {
      return (story.tags ?? []).includes(rule.value);
    }
    case 'prompt': {
      return false;
    }
  }
}
