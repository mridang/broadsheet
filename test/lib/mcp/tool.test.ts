import { describe, expect, it } from '@jest/globals';

import { READS, READS_THE_WEB, writes } from '@/lib/mcp';
import { CountTool, fixtureContext } from './tool-fixtures';

describe('READS', () => {
  it('tells a host the tool only reads, and never destroys', () => {
    expect(READS.readOnlyHint).toBe(true);
    expect(READS.destructiveHint).toBe(false);
  });

  it('tells a host the same call twice is safe', () => {
    expect(READS.idempotentHint).toBe(true);
  });

  it('tells a host the tool reads a closed world, not the internet', () => {
    expect(READS.openWorldHint).toBe(false);
  });
});

describe('READS_THE_WEB', () => {
  it('reads like READS but says the world is open', () => {
    expect(READS_THE_WEB).toEqual({ ...READS, openWorldHint: true });
  });
});

describe('writes', () => {
  it('describes a tool that adds something new, when nothing is said', () => {
    expect(writes()).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('warns a host when a tool may remove something for good', () => {
    expect(writes({ destructive: true }).destructiveHint).toBe(true);
  });

  it('tells a host when calling twice is the same as calling once', () => {
    expect(writes({ idempotent: true }).idempotentHint).toBe(true);
  });

  it('tells a host when a tool reaches the open web', () => {
    expect(writes({ openWorld: true }).openWorldHint).toBe(true);
  });

  it('never calls a writing tool read-only, whatever it is asked for', () => {
    expect(
      writes({ destructive: true, idempotent: true, openWorld: true })
        .readOnlyHint,
    ).toBe(false);
  });
});

describe('McpTool.precheck', () => {
  it('lets a call through unless a tool says otherwise', async () => {
    expect(await new CountTool().precheck(fixtureContext())).toBeUndefined();
  });
});
