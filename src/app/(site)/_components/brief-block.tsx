import type { Article } from '@/domain/repository';
import { hostOf } from '@/domain/render/tiers';

/** The low-weight tail of a desk, as a compact "In brief" list. */
export function BriefBlock({ items }: { items: Article[] }) {
  return (
    <div className="mt-2 rounded-card bg-ink/3 p-5 sm:col-span-2 print:break-inside-avoid">
      <h3 className="text-label font-semibold text-subtle uppercase">
        In brief
      </h3>
      <ul className="mt-3 divide-y divide-line">
        {items.map((a) => (
          <li key={a.id}>
            <a
              className="focus-ring group flex items-baseline justify-between gap-4 rounded-control py-2 print:after:text-label print:after:content-['_('_attr(href)_')']"
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="text-sm font-medium text-ink group-hover:text-accent">
                {a.title}
              </span>
              <span className="shrink-0 text-xs text-subtle">
                {a.source || hostOf(a.url)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
