import { describe, expect, it } from '@jest/globals';

import { TOOL_REGISTRY } from '@/domain/mcp/tools';
import type { z } from 'zod';

const collator = new Intl.Collator();

/** Every tool, as the class that carries its zod input. */
const TOOLS = TOOL_REGISTRY.all;

describe('the tool catalogue', () => {
  /** The tools that say they may destroy something. */
  const destructive = TOOL_REGISTRY.all
    .filter((tool) => tool.annotations.destructiveHint)
    .map((tool) => tool.name);

  it('warns about exactly the tools that remove something for good', () => {
    expect(destructive.toSorted((a, b) => collator.compare(a, b))).toEqual([
      'manage_notifications',
      'remove_classifier',
      'remove_section',
      'unfollow_feed',
      'unsave_article',
      'unshare_story',
    ]);
  });

  it('never calls a read-only tool destructive', () => {
    for (const tool of TOOL_REGISTRY.all.filter(
      (candidate) => candidate.annotations.readOnlyHint,
    )) {
      expect(tool.annotations.destructiveHint).toBe(false);
    }
  });

  it('describes every input in plain words', () => {
    for (const tool of TOOLS) {
      for (const field of Object.values<z.ZodType>(tool.input.shape)) {
        expect(field.description).toBeTruthy();
      }
    }
  });
});
