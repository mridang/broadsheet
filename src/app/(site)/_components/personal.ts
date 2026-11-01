import type { Repository } from '@/domain/repository';
import type { Personal } from '@/app/(site)/_components/section';

/** The reader's training, level, reads and saves, which mark their cards. */
export async function loadPersonal(
  repo: Repository,
  userId: number,
): Promise<Personal> {
  const [training, saves, reads, prefs, feeds] = await Promise.all([
    repo.listClassifiers(userId),
    repo.listSaves(userId),
    repo.readState(userId),
    repo.getPreferences(userId),
    repo.listFeeds(userId),
  ]);
  return {
    training,
    level: prefs.intelligence,
    markReadOnOpen: prefs.mark_read_on_open,
    sections: new Map(feeds.map((f) => [f.id, f.section_id])),
    read: reads.ids,
    saved: new Set(saves.map((s) => s.article.id)),
  };
}
