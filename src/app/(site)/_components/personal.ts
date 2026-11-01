import type { Repository } from '@/domain/repository';
import type { Personal } from '@/app/(site)/_components/section';

/**
 * The reader's training, level, reads, saves and shares, and how they like
 * clusters previewed, which mark their cards.
 */
export async function loadPersonal(
  repo: Repository,
  userId: number,
): Promise<Personal> {
  const [training, saves, reads, prefs, feeds, prompted, shared] =
    await Promise.all([
      repo.listClassifiers(userId),
      repo.listSaves(userId),
      repo.readState(userId),
      repo.getPreferences(userId),
      repo.listFeeds(userId),
      repo.promptMatches(userId),
      repo.sharedArticleIds(userId),
    ]);
  return {
    training,
    level: prefs.intelligence,
    markReadOnOpen: prefs.mark_read_on_open,
    markReadOnScroll: prefs.mark_read_on_scroll,
    prompted,
    sections: new Map(feeds.map((f) => [f.id, f.section_id])),
    read: reads.ids,
    saved: new Set(saves.map((s) => s.article.id)),
    shared,
    clusterExpanded: prefs.cluster_preview_style === 'expanded',
  };
}
