import type { ReactElement } from 'react';

import { elementLabel } from '@/domain/render/feed-details';
import type { FeedElement } from '@/lib/scraping';

/** A value that is an address, shown as a link to it. */
function Value({ text }: { readonly text: string }): ReactElement {
  return /^https?:\/\//i.test(text) ? (
    <a
      href={text}
      target="_blank"
      rel="noopener noreferrer"
      className="focus-ring rounded-sm wrap-anywhere text-accent hover:underline"
    >
      {text}
    </a>
  ) : (
    <>{text}</>
  );
}

/**
 * Every element of a feed's header, as the feed gives it: each element's
 * label, its text, every attribute and, nested, its own elements. Nothing is
 * left out or chosen.
 */
export function FeedMetadata({
  elements,
  nested = false,
}: {
  readonly elements: readonly FeedElement[];
  /** Drawn inside another element's value, indented under it. */
  readonly nested?: boolean;
}): ReactElement {
  return (
    <dl
      className={
        nested
          ? 'mt-2 space-y-2 border-l-2 border-line pl-4'
          : 'divide-y divide-line rounded-card border border-line bg-surface text-sm'
      }
    >
      {elements.map((e, i) => (
        <div key={i} className={nested ? 'min-w-0' : 'min-w-0 px-5 py-3'}>
          <dt className="text-xs font-medium text-subtle">
            {elementLabel(e.name)}{' '}
            <code className="font-mono text-xs text-subtle">{e.name}</code>
          </dt>
          <dd className="mt-0.5 wrap-break-word text-ink">
            {e.text ? <Value text={e.text} /> : null}
            {Object.entries(e.attributes).length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-xs text-muted">
                {Object.entries(e.attributes).map(([name, value]) => (
                  <li key={name}>
                    <code className="font-mono text-subtle">{name}</code>{' '}
                    <Value text={value} />
                  </li>
                ))}
              </ul>
            ) : null}
            {e.children.length > 0 ? (
              <FeedMetadata elements={e.children} nested />
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
