import type { Article } from '@/domain/repository';
import type { Layout } from '@/domain/render/layout';
import { Section, type Personal } from '@/app/(site)/_components/section';
import { LegalLinks } from '@/app/(site)/_components/legal-links';

/**
 * A laid-out paper: the editor's note when there is one, then each section's
 * desks under its heading (the unfiled ones lead with none), then the foot.
 */
export function Paper({
  layout,
  articles,
  briefing,
  personal,
}: {
  layout: Layout;
  articles: ReadonlyMap<number, Article>;
  briefing: string | null;
  personal?: Personal;
}) {
  return (
    <>
      {briefing ? (
        <aside className="editors-note" aria-label="Editor's note">
          <h2>Editor&rsquo;s note</h2>
          <p>{briefing}</p>
        </aside>
      ) : null}
      {layout.groups.map((group, i) => (
        <div key={group.name ?? `unfiled-${i}`}>
          {group.name ? <h2 className="deskhead">{group.name}</h2> : null}
          {group.desks.map((desk) => (
            <Section
              key={desk.feed_id}
              desk={desk}
              articles={articles}
              personal={personal}
            />
          ))}
        </div>
      ))}
      <div className="foot">
        THE HACKER TIMES — auto-generated from your feeds, refreshed daily.
        Every day is archived.
        <LegalLinks />
      </div>
      <div className="enginenote">
        Generative layout: weight → tier → copyfit, with an In Brief rail for
        the low-weight tail. The same story from several sources prints once.
      </div>
    </>
  );
}
