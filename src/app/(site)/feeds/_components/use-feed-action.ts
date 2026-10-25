'use client';

import { useApiAction, type ApiAction } from '@/components/api/use-api-action';

/** What a feed control shows while its request runs and after it fails. */
export type FeedAction = ApiAction;

/**
 * Shared behaviour of the controls on the feed manager: the generic
 * {@link useApiAction}, reloading the page on success so the change shows.
 */
export function useFeedAction(): FeedAction {
  return useApiAction(() => window.location.reload());
}
