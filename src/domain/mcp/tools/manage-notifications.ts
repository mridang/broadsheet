/**
 * @packageDocumentation
 *
 * `manage_notifications`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import {
  notificationResource,
  parseNotificationInput,
} from '@/domain/api/notification-resource';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { checked, id } from '@/domain/mcp/tools/support';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_FILTERS,
  NotificationRepository,
} from '@/domain/notifications';
import { type ToolAnnotations, writes } from '@/lib/mcp';
import { z } from 'zod';

/** What `manage_notifications` accepts. */
const SCHEMA = z.object({
  action: z
    .enum(['list', 'set', 'remove'])
    .describe(
      'List every feed’s notifications, set one feed’s, or remove them.',
    ),
  feed_id: id('feed').optional().describe('The feed, for set and remove.'),
  channels: z
    .array(z.enum(NOTIFICATION_CHANNELS))
    .min(1)
    .optional()
    .describe('For set: where to send them.'),
  filter: z
    .enum(NOTIFICATION_FILTERS)
    .default('unread')
    .describe('For set: which new stories to send.'),
});

export class ManageNotificationsTool extends JsonTool<
  'manage_notifications',
  typeof SCHEMA
> {
  readonly name = 'manage_notifications';

  readonly title = 'Manage notifications';

  readonly description =
    'List, set or remove the notifications for new stories in a feed. Channels are web (push), email and webhook; the filter is unread (any story not disliked) or focus (only liked ones).';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes({ destructive: true });

  protected override async runParsed(
    { action, feed_id, channels, filter }: z.infer<typeof SCHEMA>,
    { user, services }: ToolContext,
  ): Promise<object> {
    const uid = user.id;
    const db = services.openDatabase();
    const notifications = new NotificationRepository(db);
    if (action === 'list') {
      const rows = await notifications.feedNotifications(uid);
      return {
        notifications: rows.map((n) => ({
          ...notificationResource(n.feed_id, n),
          feed_title: n.feed_title,
        })),
      };
    }
    if (feed_id === undefined) throw new ToolFailureError('Send feed_id.');
    if (action === 'remove') {
      if (!(await notifications.removeFeedNotification(uid, feed_id))) {
        throw new ToolFailureError('That feed has no notifications.');
      }
      return { removed: true };
    }
    const setting = checked(
      parseNotificationInput({ filter, channels: channels ?? [] }),
    ).value;
    const result = await notifications.setFeedNotification(
      uid,
      feed_id,
      setting,
    );
    if (!result) throw new ToolFailureError('There is no such feed.');
    return {
      notification: notificationResource(feed_id, setting),
      created: result.created,
    };
  }
}
