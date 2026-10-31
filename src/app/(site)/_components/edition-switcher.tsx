/** A custom edition the switcher links to. */
export interface EditionLink {
  readonly id: number;
  readonly name: string;
}

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
    <nav className="editionbar" aria-label="Editions">
      <a href="/" aria-current={selected === undefined ? 'page' : undefined}>
        Daily
      </a>
      {editions.map((e) => (
        <a
          key={e.id}
          href={`/?edition=${e.id}`}
          aria-current={selected === e.id ? 'page' : undefined}
        >
          {e.name}
        </a>
      ))}
      <a href="/editions" className="muted">
        + Edition
      </a>
    </nav>
  );
}
