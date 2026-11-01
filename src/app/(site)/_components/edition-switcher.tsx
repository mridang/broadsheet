/** A custom edition the switcher links to. */
export interface EditionLink {
  readonly id: number;
  readonly name: string;
}

/** The look of each paper's tab. */
const TAB =
  'focus-ring inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-sm font-medium text-muted hover:bg-ink/5 hover:text-ink aria-[current=page]:bg-ink aria-[current=page]:text-on-ink';

/**
 * The row of papers above the front page: the daily one, each custom edition
 * (`/?edition={id}`), and a link to manage them. `selected` is the custom
 * edition showing, or undefined for the daily paper.
 */
export function EditionSwitcher({
  editions,
  selected,
}: Readonly<{ editions: readonly EditionLink[]; selected?: number }>) {
  return (
    <nav
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 print:hidden"
      aria-label="Editions"
    >
      <a
        className={TAB}
        href="/"
        aria-current={selected === undefined ? 'page' : undefined}
      >
        Daily
      </a>
      {editions.map((e) => (
        <a
          key={e.id}
          className={TAB}
          href={`/?edition=${e.id}`}
          aria-current={selected === e.id ? 'page' : undefined}
        >
          {e.name}
        </a>
      ))}
      <a href="/editions" className={TAB}>
        + Edition
      </a>
    </nav>
  );
}
