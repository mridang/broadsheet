'use client';

import type { ReactElement, SubmitEvent } from 'react';

import { importTopics } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import type { Topic } from '@/domain/topics';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';

/**
 * What a new reader sees before following anything: pick topics and their
 * starter feeds are followed through the imports endpoint.
 */
export function TopicPicker({
  topics,
}: {
  readonly topics: readonly Topic[];
}): ReactElement {
  const { busy, error, run } = useFeedAction();
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const ids = new FormData(event.currentTarget).getAll('topic').map(String);
    void run(() => importTopics(ids), 'Could not follow those topics.');
  };
  return (
    <form onSubmit={submit}>
      <fieldset>
        <legend className="text-sm text-muted">
          Pick a few topics to start your paper
        </legend>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {topics.map((topic) => (
            <label
              className="flex gap-3 rounded-card border border-line bg-surface p-4 hover:border-field has-checked:border-accent has-checked:bg-accent/5"
              key={topic.id}
            >
              <input
                type="checkbox"
                name="topic"
                value={topic.id}
                className="mt-0.5"
              />{' '}
              <span className="min-w-0">
                <strong className="block text-sm font-semibold">
                  {topic.name}
                </strong>
                <span className="mt-1 block text-xs text-subtle">
                  {topic.feeds.map((feed) => feed.title).join(', ')}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <button
        className={buttonClass({ size: 'lg', className: 'mt-6' })}
        type="submit"
        disabled={busy}
      >
        Start my paper
      </button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </form>
  );
}
