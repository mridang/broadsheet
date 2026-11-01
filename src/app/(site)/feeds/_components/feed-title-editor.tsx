'use client';

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';

import { editFeed } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { buttonClass, IconButton, TextLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { ErrorText } from '@/components/ui/notice';

/**
 * The title a feed is saved under for what was typed: trimmed, and null (the
 * feed's own title) when blank.
 */
export function editedTitle(typed: string): string | null {
  return typed.trim() || null;
}

/**
 * A feed's name in a row of the feed manager, linking to the feed, with a
 * pencil that turns it into a field to rename the feed in place. Enter saves
 * and Escape puts the name back.
 */
export function FeedTitleEditor({
  id,
  title,
  name,
}: Readonly<{
  id: number;
  /** The title the person gave the feed, blank when it has none. */
  title: string;
  /** The name shown: the person's title, the feed's own, or its host. */
  name: string;
}>): ReactElement {
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useFeedAction();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) field.current?.select();
  }, [editing]);
  if (!editing) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <TextLink href={`/feeds/${id}`} className="truncate">
          {name}
        </TextLink>
        <IconButton label={`Rename ${name}`} onClick={() => setEditing(true)}>
          <Icon name="pencil" className="size-4" />
        </IconButton>
      </span>
    );
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const typed = String(new FormData(event.currentTarget).get('title') ?? '');
    void run(
      () => editFeed(id, { title: editedTitle(typed) }),
      'Could not rename that feed.',
    );
  };
  const escape = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') setEditing(false);
  };
  return (
    <form className="p-0.5" onSubmit={submit}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="title"
          type="text"
          aria-label="Name"
          defaultValue={title || name}
          maxLength={200}
          ref={field}
          onKeyDown={escape}
          className="min-w-0 flex-1"
        />
        <button
          type="submit"
          className={buttonClass({ size: 'xs' })}
          disabled={busy}
        >
          Save
        </button>
        <button
          type="button"
          className={buttonClass({ variant: 'ghost', size: 'xs' })}
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </form>
  );
}
