'use client';

import { z } from 'zod';
import { useApiAction } from '@/components/api/use-api-action';

import { buttonClass } from '@/components/ui/button';
import { CHECK_LABEL } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';
import { addRule } from '@/app/(site)/settings/_components/settings-requests';
import type { ReactElement, SubmitEvent } from 'react';
import type { RuleRequest } from '@/app/(site)/settings/_components/settings-requests';

/** The fields the rule form posts. */
const ruleForm = z.object({
  where: z.string().default('all'),
  kind: z.string().default('title'),
  value: z.string().default(''),
});

/** The scope a rule's "Where to look" choice names. */
function scopeOf(where: string) {
  if (where.startsWith('feed:')) {
    return { scope: 'feed', feed_id: where.slice('feed:'.length) };
  }
  if (where.startsWith('section:')) {
    return { scope: 'section', section_id: where.slice('section:'.length) };
  }
  return { scope: 'all' };
}

/** The request a filled-in rule form makes. */
export function ruleRequest(form: FormData): RuleRequest {
  const fields = ruleForm.parse(Object.fromEntries(form));
  const where = fields.where;
  const scope = scopeOf(where);
  return {
    kind: fields.kind,
    value: fields.value,
    is_regex: form.get('is_regex') === 'on',
    ...scope,
    channels: form.getAll('channels').map(String),
  };
}

/** The label each notification channel shows in the form. */
const CHANNEL_LABELS = {
  web: 'Push',
  email: 'Email',
  webhook: 'Webhook',
} as const;

/** The box for adding a rule that notifies about matching stories. */
export function AddRuleForm({
  feeds,
  sections,
}: Readonly<{
  feeds: readonly { id: number; title: string }[];
  sections: readonly { id: number; name: string }[];
}>): ReactElement {
  const { busy, error, run } = useApiAction(() => globalThis.location.reload());
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const request = ruleRequest(new FormData(event.currentTarget));
    void run(async () => addRule(request), 'Could not add that rule.');
  };
  return (
    <>
      <form className="space-y-3" onSubmit={submit}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select name="kind" defaultValue="title" aria-label="What to match">
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
            aria-label="Phrase, pattern or prompt"
            required
            className="min-w-0 sm:flex-1"
          />
          <select name="where" defaultValue="all" aria-label="Where to look">
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
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className={CHECK_LABEL}>
            <input
              aria-label="Regular expression"
              name="is_regex"
              type="checkbox"
            />{' '}
            Regular expression
          </label>
          {(['web', 'email', 'webhook'] as const).map((channel) => (
            <label key={channel} className={CHECK_LABEL}>
              <input
                aria-label={CHANNEL_LABELS[channel]}
                name="channels"
                type="checkbox"
                value={channel}
                defaultChecked={channel === 'web'}
              />{' '}
              {CHANNEL_LABELS[channel]}
            </label>
          ))}
          <button
            // eslint-disable-next-line unicorn/no-keyword-prefix -- className is the React DOM prop name, fixed by the JSX API
            className={buttonClass({ className: 'sm:ml-auto' })}
            type="submit"
            disabled={busy}
          >
            Add rule
          </button>
        </div>
      </form>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
