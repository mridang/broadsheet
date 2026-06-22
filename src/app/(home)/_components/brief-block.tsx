import type { Article } from '@/lib/db';
import { hostOf } from '@/lib/render/tiers';

/** The low-weight tail, rendered as a newspaper "In Brief" rail. */
export function BriefBlock({ items }: { items: Article[] }) {
  return (
    <article className="card w-all brief-block">
      <div className="meat">
        <div className="brief-h">In Brief</div>
        {items.map((a) => (
          <a
            key={a.id}
            className="brief-item"
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="bt">{a.title}</span>
            <span className="bs">{a.source || hostOf(a.url)}</span>
          </a>
        ))}
      </div>
    </article>
  );
}
