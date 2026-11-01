'use client';

import type { FormEvent, ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import { buttonClass } from '@/components/ui/button';
import { CHECK_LABEL, CHECKBOX, fieldClass } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';
import {
  addRule,
  type RuleRequest,
} from '@/app/(site)/settings/_components/settings-requests';

/** The request a filled-in rule form makes. */
export function ruleRequest(form: FormData): RuleRequest {
  const where = String(form.get('where') ?? 'all');
  const scope = where.startsWith('feed:')
    ? { scope: 'feed', feed_id: where.slice('feed:'.length) }
    : where.startsWith('section:')
      ? { scope: 'section', section_id: where.slice('section:'.length) }
      : { scope: 'all' };
  return {
    kind: String(form.get('kind') ?? 'title'),
    value: String(form.get('value') ?? ''),
    is_regex: form.get('is_regex') === 'on',
    ...scope,
    channels: form.getAll('channels').map(String),
  };
}

/** The box for adding a rule that notifies about matching stories. */
export function AddRuleForm({
  feeds,
  sections,
}: Readonly<{
  feeds: readonly { id: number; title: string }[];
  sections: readonly { id: number; name: string }[];
}>): ReactElement {
  const { busy, error, run } = useApiAction(() => window.location.reload());
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const request = ruleRequest(new FormData(event.currentTarget));
    void run(() => addRule(request), 'Could not add that rule.');
  };
  return (
    <>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
        onSubmit={submit}
      >
        <select
          name="kind"
          defaultValue="title"
          aria-label="What to match"
          className={fieldClass()}
        >
          <option value="title">Title</option>
          <option value="text">Text</option>
          <option value="url">Address</option>
          <option value="author">Author</option>
          <option value="tag">Tag</option>
          <option value="prompt">AI prompt</option>
        </select>
        <input
          name="value"
          type="text"
          maxLength={200}
          placeholder="Phrase, pattern or prompt"
          required
          className={fieldClass('w-full sm:flex-1')}
        />
        <label className={CHECK_LABEL}>
          <input name="is_regex" type="checkbox" className={CHECKBOX} /> Regular
          expression
        </label>
        <select
          name="where"
          defaultValue="all"
          aria-label="Where to look"
          className={fieldClass()}
        >
          <option value="all">Every feed</option>
          {sections.map((s) => (
            <option key={`s${s.id}`} value={`section:${s.id}`}>
              Section: {s.name}
            </option>
          ))}
          {feeds.map((f) => (
            <option key={`f${f.id}`} value={`feed:${f.id}`}>
              Feed: {f.title}
            </option>
          ))}
        </select>
        {(['web', 'email', 'webhook'] as const).map((channel) => (
          <label key={channel} className={CHECK_LABEL}>
            <input
              className={CHECKBOX}
              name="channels"
              type="checkbox"
              value={channel}
              defaultChecked={channel === 'web'}
            />{' '}
            {channel === 'web'
              ? 'Push'
              : channel === 'email'
                ? 'Email'
                : 'Webhook'}
          </label>
        ))}
        <button className={buttonClass({})} type="submit" disabled={busy}>
          Add rule
        </button>
      </form>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
