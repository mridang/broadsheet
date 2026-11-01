import { storyChanges } from '@/domain/render/changes';

/**
 * NewsBlur's "show changes" on a story whose text changed since it was first
 * seen: a disclosure with the words taken out struck through and the words
 * added underlined, read from the text alone so no markup reaches the page.
 */
export function StoryChanges({
  original,
  current,
}: Readonly<{ original: string; current: string }>) {
  return (
    <details className="pointer-events-auto relative z-10 mt-2 text-sm print:hidden">
      <summary className="focus-ring inline-flex w-fit items-center gap-1 rounded-sm text-xs font-medium text-accent">
        Updated · show changes
      </summary>
      <p
        data-part=""
        className="mt-2 rounded-control border border-line bg-surface p-3 leading-relaxed text-muted"
      >
        {storyChanges(original, current).map((c, i) =>
          c.op === 'same' ? (
            <span key={i}>{`${c.text} `}</span>
          ) : c.op === 'del' ? (
            <del
              key={i}
              className="bg-red-500/10 text-red-800 line-through dark:text-red-300"
            >{`${c.text} `}</del>
          ) : (
            <ins
              key={i}
              className="bg-green-500/15 text-green-900 no-underline dark:text-green-300"
            >{`${c.text} `}</ins>
          ),
        )}
      </p>
    </details>
  );
}
