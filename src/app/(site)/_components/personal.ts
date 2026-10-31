import type { Repository } from '@/domain/repository';
import type { Personal } from '@/app/(site)/_components/section';

/** The reader's training, reads and saves, which mark their cards. */
export async function loadPersonal(
  repo: Repository,
  userId: number,
): Promise<Personal> {
  const [training, saves, reads] = await Promise.all([
    repo.listClassifiers(userId),
    repo.listSaves(userId),
    repo.readState(userId),
  ]);
  return {
    training,
    read: reads.ids,
    saved: new Set(saves.map((s) => s.article.id)),
  };
}
