/**
 * @packageDocumentation
 *
 * The browser's calls to the feeds API. Each resolves when the server did what
 * was asked and throws a `ProblemError` carrying the server's own words when it
 * refused (see `problemText`).
 */

import { ensureOk } from '@/components/api/problem-message';

/** Follow the feed at `url` (`POST /api/feeds`). */
export async function followFeed(url: string): Promise<void> {
  await ensureOk(
    await fetch('/api/feeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }),
  );
}

/** Stop following the feed with this id (`DELETE /api/feeds/:id`). */
export async function unfollowFeed(id: number): Promise<void> {
  await ensureOk(await fetch(`/api/feeds/${id}`, { method: 'DELETE' }));
}

/** Fetch every followed feed again now (`POST /api/feeds/refreshes`). */
export async function refreshFeeds(): Promise<void> {
  await ensureOk(await fetch('/api/feeds/refreshes', { method: 'POST' }));
}

/** What can be changed about a feed; null clears the title or section. */
export interface FeedEdit {
  readonly title?: string | null;
  readonly url?: string;
  readonly muted?: boolean;
  readonly section_id?: string | null;
}

/** Rename, mute or file the feed with this id (`PATCH /api/feeds/:id`). */
export async function editFeed(id: number, edit: FeedEdit): Promise<void> {
  await ensureOk(
    await fetch(`/api/feeds/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edit),
    }),
  );
}

/**
 * Add a section called `name`, inside the section `parentId` when given
 * (`POST /api/sections`).
 */
export async function addSection(
  name: string,
  parentId?: string,
): Promise<void> {
  await ensureOk(
    await fetch('/api/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parentId ? { name, parent_id: parentId } : { name }),
    }),
  );
}

/** Remove the section with this id (`DELETE /api/sections/:id`). */
export async function removeSection(id: number): Promise<void> {
  await ensureOk(await fetch(`/api/sections/${id}`, { method: 'DELETE' }));
}

/** Follow the feeds of these topics (`POST /api/feeds/imports`). */
export async function importTopics(topicIds: readonly string[]): Promise<void> {
  await ensureOk(
    await fetch('/api/feeds/imports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_ids: topicIds }),
    }),
  );
}

/** The feeds as an OPML document (`GET /api/feeds` asking for OPML). */
export async function fetchOpml(): Promise<Blob> {
  const res = await fetch('/api/feeds', {
    headers: { Accept: 'text/x-opml' },
  });
  await ensureOk(res);
  return res.blob();
}

/** What an import did (`POST /api/feeds/imports`). */
export interface ImportResult {
  readonly added: number;
  readonly skipped: number;
  readonly rejected: readonly unknown[];
}

/** Follow the feeds of an OPML file (`POST /api/feeds/imports`). */
export async function importOpml(file: Blob): Promise<ImportResult> {
  const res = await fetch('/api/feeds/imports', {
    method: 'POST',
    headers: { 'Content-Type': 'text/x-opml' },
    body: file,
  });
  await ensureOk(res);
  return (await res.json()) as ImportResult;
}

/** Fetch one feed again, forgetting its failures (`POST /api/feeds/:id/refreshes`). */
export async function retryFeed(id: number): Promise<void> {
  await ensureOk(await fetch(`/api/feeds/${id}/refreshes`, { method: 'POST' }));
}
