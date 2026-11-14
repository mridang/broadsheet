/**
 * @packageDocumentation
 *
 * Every tool this app offers. Adding one means writing its class beside this
 * file and naming it here; nothing else holds a list to keep in step.
 */

import { ToolRegistry, type NameOf } from '@/lib/mcp';
import type { ToolContent, ToolContext } from '@/domain/mcp/tool-context';
import { ListFeedsTool } from '@/domain/mcp/tools/list-feeds';
import { GetFeedTool } from '@/domain/mcp/tools/get-feed';
import { FollowFeedTool } from '@/domain/mcp/tools/follow-feed';
import { UnfollowFeedTool } from '@/domain/mcp/tools/unfollow-feed';
import { ReadPaperTool } from '@/domain/mcp/tools/read-paper';
import { SearchArticlesTool } from '@/domain/mcp/tools/search-articles';
import { GetArticleTool } from '@/domain/mcp/tools/get-article';
import { SaveArticleTool } from '@/domain/mcp/tools/save-article';
import { UnsaveArticleTool } from '@/domain/mcp/tools/unsave-article';
import { ListClassifiersTool } from '@/domain/mcp/tools/list-classifiers';
import { TrainClassifierTool } from '@/domain/mcp/tools/train-classifier';
import { AddClassifierTool } from '@/domain/mcp/tools/add-classifier';
import { RemoveClassifierTool } from '@/domain/mcp/tools/remove-classifier';
import { GetAccountTool } from '@/domain/mcp/tools/get-account';
import { OrganizeFeedTool } from '@/domain/mcp/tools/organize-feed';
import { AddSectionTool } from '@/domain/mcp/tools/add-section';
import { UpdateSectionTool } from '@/domain/mcp/tools/update-section';
import { RemoveSectionTool } from '@/domain/mcp/tools/remove-section';
import { MarkReadTool } from '@/domain/mcp/tools/mark-read';
import { MarkUnreadTool } from '@/domain/mcp/tools/mark-unread';
import { ListSavedTool } from '@/domain/mcp/tools/list-saved';
import { GetBriefingTool } from '@/domain/mcp/tools/get-briefing';
import { GetTrendingTool } from '@/domain/mcp/tools/get-trending';
import { DiscoverFeedsTool } from '@/domain/mcp/tools/discover-feeds';
import { AskArchiveTool } from '@/domain/mcp/tools/ask-archive';
import { ShareStoryTool } from '@/domain/mcp/tools/share-story';
import { UnshareStoryTool } from '@/domain/mcp/tools/unshare-story';
import { GetSharedStoriesTool } from '@/domain/mcp/tools/get-shared-stories';
import { GetInfrequentStoriesTool } from '@/domain/mcp/tools/get-infrequent-stories';
import { GetArchiveStatsTool } from '@/domain/mcp/tools/get-archive-stats';
import { ManageNotificationsTool } from '@/domain/mcp/tools/manage-notifications';

export { ListFeedsTool } from '@/domain/mcp/tools/list-feeds';
export { GetFeedTool } from '@/domain/mcp/tools/get-feed';
export { FollowFeedTool } from '@/domain/mcp/tools/follow-feed';
export { UnfollowFeedTool } from '@/domain/mcp/tools/unfollow-feed';
export { ReadPaperTool } from '@/domain/mcp/tools/read-paper';
export { SearchArticlesTool } from '@/domain/mcp/tools/search-articles';
export { GetArticleTool } from '@/domain/mcp/tools/get-article';
export { SaveArticleTool } from '@/domain/mcp/tools/save-article';
export { UnsaveArticleTool } from '@/domain/mcp/tools/unsave-article';
export { ListClassifiersTool } from '@/domain/mcp/tools/list-classifiers';
export { TrainClassifierTool } from '@/domain/mcp/tools/train-classifier';
export { AddClassifierTool } from '@/domain/mcp/tools/add-classifier';
export { RemoveClassifierTool } from '@/domain/mcp/tools/remove-classifier';
export { GetAccountTool } from '@/domain/mcp/tools/get-account';
export { OrganizeFeedTool } from '@/domain/mcp/tools/organize-feed';
export { AddSectionTool } from '@/domain/mcp/tools/add-section';
export { UpdateSectionTool } from '@/domain/mcp/tools/update-section';
export { RemoveSectionTool } from '@/domain/mcp/tools/remove-section';
export { MarkReadTool } from '@/domain/mcp/tools/mark-read';
export { MarkUnreadTool } from '@/domain/mcp/tools/mark-unread';
export { ListSavedTool } from '@/domain/mcp/tools/list-saved';
export { GetBriefingTool } from '@/domain/mcp/tools/get-briefing';
export { GetTrendingTool } from '@/domain/mcp/tools/get-trending';
export { DiscoverFeedsTool } from '@/domain/mcp/tools/discover-feeds';
export { AskArchiveTool } from '@/domain/mcp/tools/ask-archive';
export { ShareStoryTool } from '@/domain/mcp/tools/share-story';
export { UnshareStoryTool } from '@/domain/mcp/tools/unshare-story';
export { GetSharedStoriesTool } from '@/domain/mcp/tools/get-shared-stories';
export { GetInfrequentStoriesTool } from '@/domain/mcp/tools/get-infrequent-stories';
export { GetArchiveStatsTool } from '@/domain/mcp/tools/get-archive-stats';
export { ManageNotificationsTool } from '@/domain/mcp/tools/manage-notifications';

/**
 * Every tool, in the order `tools/list` shows them. Declared `as const` so that
 * {@link ToolName} is the union of the real names rather than `string`.
 */
const TOOLS = [
  new ListFeedsTool(),
  new GetFeedTool(),
  new FollowFeedTool(),
  new UnfollowFeedTool(),
  new ReadPaperTool(),
  new SearchArticlesTool(),
  new GetArticleTool(),
  new SaveArticleTool(),
  new UnsaveArticleTool(),
  new ListClassifiersTool(),
  new TrainClassifierTool(),
  new AddClassifierTool(),
  new RemoveClassifierTool(),
  new GetAccountTool(),
  new OrganizeFeedTool(),
  new AddSectionTool(),
  new UpdateSectionTool(),
  new RemoveSectionTool(),
  new MarkReadTool(),
  new MarkUnreadTool(),
  new ListSavedTool(),
  new GetBriefingTool(),
  new GetTrendingTool(),
  new DiscoverFeedsTool(),
  new AskArchiveTool(),
  new ShareStoryTool(),
  new UnshareStoryTool(),
  new GetSharedStoriesTool(),
  new GetInfrequentStoriesTool(),
  new GetArchiveStatsTool(),
  new ManageNotificationsTool(),
] as const;

/** The name of one of this app's tools. */
export type ToolName = NameOf<typeof TOOLS>;

/** Every tool this app offers, looked up by name. */
export const TOOL_REGISTRY = new ToolRegistry<
  ToolName,
  ToolContext,
  ToolContent
>(TOOLS);
