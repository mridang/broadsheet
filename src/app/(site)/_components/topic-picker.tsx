'use client';

import type { FormEvent, ReactElement } from 'react';

import { importTopics } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import type { Topic } from '@/domain/topics';

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
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const ids = new FormData(event.currentTarget).getAll('topic').map(String);
    void run(() => importTopics(ids), 'Could not follow those topics.');
  };
  return (
    <form onSubmit={submit}>
      <fieldset>
        <legend>Pick a few topics to start your paper</legend>
        {topics.map((topic) => (
          <label className="feedrow" key={topic.id}>
            <input type="checkbox" name="topic" value={topic.id} />{' '}
            <strong>{topic.name}</strong>
            <span className="u">
              {topic.feeds.map((feed) => feed.title).join(', ')}
            </span>
          </label>
        ))}
      </fieldset>
      <button className="btn" type="submit" disabled={busy}>
        Start my paper
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
