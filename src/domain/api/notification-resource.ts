/**
 * @packageDocumentation
 *
 * A feed's notifications on the wire: the representation
 * `/api/users/self/notifications/{feed_id}` sends, and checking the body a
 * client puts to set them.
 */

import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_FILTERS,
  type NotificationChannel,
  type NotificationFilter,
  type NotificationSetting,
} from '@/domain/notifications';
import type { Checked } from '@/domain/api/outbound-resource';

/** A feed's notifications as the API shows them. */
export interface NotificationResource {
  readonly feed_id: string;
  readonly filter: NotificationFilter;
  readonly channels: readonly NotificationChannel[];
}

/** The API's view of one feed's notifications. */
export function notificationResource(
  feedId: number,
  setting: NotificationSetting,
): NotificationResource {
  return {
    feed_id: String(feedId),
    filter: setting.filter,
    channels: setting.channels,
  };
}

/**
 * Check a notification body: `filter` unread or focus (unread when left
 * out), `channels` a non-empty list of web, email and webhook. Turning every
 * channel off is a DELETE, not an empty list.
 */
export function parseNotificationInput(
  body: Readonly<Record<string, unknown>>,
): Checked<NotificationSetting> {
  const errors = Object.keys(body)
    .filter((key) => key !== 'filter' && key !== 'channels')
    .map((key) => `${key}: not a member of a notification.`);
  const { filter = 'unread', channels } = body;
  if (!(NOTIFICATION_FILTERS as readonly unknown[]).includes(filter)) {
    errors.push(`filter: must be one of ${NOTIFICATION_FILTERS.join(', ')}.`);
  }
  if (
    !Array.isArray(channels) ||
    !channels.length ||
    !channels.every((c) =>
      (NOTIFICATION_CHANNELS as readonly unknown[]).includes(c),
    )
  ) {
    errors.push(
      `channels: must be a non-empty list of ${NOTIFICATION_CHANNELS.join(', ')}.`,
    );
  }
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          filter: filter as NotificationFilter,
          channels: [...new Set(channels as NotificationChannel[])],
        },
      };
}
