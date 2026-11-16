import { CHIP } from '@/components/ui/badge';

/** A custom edition the switcher links to. */
export interface EditionLink {
  readonly id: number;
  readonly name: string;
}

/** The look of each paper's tab: a chip, filled in ink while current. */
const TAB = CHIP;

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
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 print:hidden"
      aria-label="Editions"
    >
      <a
        className={TAB}
        href="/"
        aria-current={selected === undefined ? 'page' : undefined}
      >
        Daily
      </a>
      {editions.map((event) => (
        <a
          key={event.id}
          className={TAB}
          href={`/?edition=${event.id}`}
          aria-current={selected === event.id ? 'page' : undefined}
        >
          {event.name}
        </a>
      ))}
      <a href="/editions" className={TAB}>
        + Edition
      </a>
    </nav>
  );
}
