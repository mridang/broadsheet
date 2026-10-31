import { formatEdition } from '@/domain/render/tiers';

/**
 * Date navigation at the top of the paper: page to the previous/next day's
 * issue (`/edition/{date}`), with a calendar dropdown listing the full archive (all days kept).
 */
export function EditionBar({
  selected,
  editions,
}: {
  selected: string;
  editions: string[];
}) {
  const i = editions.indexOf(selected);
  const older = i >= 0 ? editions[i + 1] : undefined; // editions are newest-first
  const newer = i > 0 ? editions[i - 1] : undefined;

  return (
    <div className="editionbar">
      {older ? (
        <a
          className="ednav"
          href={`/edition/${older}`}
          aria-label="Previous day"
        >
          ◀
        </a>
      ) : (
        <span className="ednav disabled" aria-hidden="true">
          ◀
        </span>
      )}

      <span className="eddate">{formatEdition(selected)}</span>

      {newer ? (
        <a className="ednav" href={`/edition/${newer}`} aria-label="Next day">
          ▶
        </a>
      ) : (
        <span className="ednav disabled" aria-hidden="true">
          ▶
        </span>
      )}

      {editions.length > 1 && (
        <details className="archive">
          <summary aria-label="Browse the archive" title="Archive">
            🗓
          </summary>
          <div className="archive-list">
            {editions.map((d) => (
              <a
                key={d}
                href={`/edition/${d}`}
                className={d === selected ? 'cur' : ''}
              >
                {formatEdition(d)}
              </a>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
