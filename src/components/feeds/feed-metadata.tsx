import type { ReactElement } from 'react';

import { elementLabel } from '@/domain/render/feed-details';
import type { FeedElement } from '@/lib/scraping';

/** A value that is an address, shown as a link to it. */
function Value({ text }: { readonly text: string }): ReactElement {
  return /^https?:\/\//i.test(text) ? (
    <a href={text} target="_blank" rel="noopener noreferrer">
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
}: {
  readonly elements: readonly FeedElement[];
}): ReactElement {
  return (
    <dl className="feedmeta">
      {elements.map((e, i) => (
        <div key={i}>
          <dt>
            {elementLabel(e.name)} <code>{e.name}</code>
          </dt>
          <dd>
            {e.text ? <Value text={e.text} /> : null}
            {Object.entries(e.attributes).length ? (
              <ul className="attrs">
                {Object.entries(e.attributes).map(([name, value]) => (
                  <li key={name}>
                    <code>{name}</code> <Value text={value} />
                  </li>
                ))}
              </ul>
            ) : null}
            {e.children.length ? <FeedMetadata elements={e.children} /> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
