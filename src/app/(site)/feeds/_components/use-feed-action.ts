'use client';

import { useApiAction } from '@/components/api/use-api-action';
import type { ApiAction } from '@/components/api/use-api-action';

/**
 * Shared behaviour of the controls on the feed manager: the generic
 * {@link useApiAction}, reloading the page on success so the change shows.
 */
export function useFeedAction(): ApiAction {
  return useApiAction(() => globalThis.location.reload());
}
