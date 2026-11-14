import { describe, expect, it } from '@jest/globals';

import {
  BackendFailureError,
  InvalidToolArgumentsError,
  NoExplanations,
  ToolInvoker,
  ToolRegistry,
  UnknownToolError,
  type FailureExplainer,
  type FailureLog,
} from '@/lib/mcp';
import {
  CountTool,
  DeleteTool,
  FetchTool,
  RenameTool,
  fixtureContext,
  type FixtureContext,
} from './tool-fixtures';

/** The text of a result's one piece of content. */
const textOf = (result: { content: readonly { text: string }[] }) =>
  result.content.map((part) => part.text).join('\n');

/** A log that remembers what it was told, so a test can read it back. */
class RecordingLog implements FailureLog {
  readonly entries: { service: string; cause: unknown }[] = [];

  record(service: string, cause: unknown): void {
    this.entries.push({ service, cause });
  }
}

/** A tool that always fails the way a failing database does. */
class BrokenTool extends DeleteTool {
  override async handle(): Promise<never> {
    throw new BackendFailureError('the database', new Error('secret detail'));
  }
}

/** A tool that fails the way a mistake in our own code does. */
class BuggyTool extends FetchTool {
  override async handle(): Promise<never> {
    throw new Error('a bug');
  }
}

function invokerFor(
  tools: readonly ConstructorParameters<
    typeof ToolRegistry<string, FixtureContext>
  >[0][number][] = [
    new CountTool(),
    new FetchTool(),
    new RenameTool(),
    new DeleteTool(),
  ],
  failures: FailureExplainer = new NoExplanations(),
  log: FailureLog = new RecordingLog(),
) {
  return new ToolInvoker<string, FixtureContext>({
    registry: new ToolRegistry<string, FixtureContext>(tools),
    failures,
    log,
  });
}

describe('ToolInvoker.invoke', () => {
  it('runs the tool a well-formed call names', async () => {
    const context = fixtureContext();
    const result = await invokerFor().invoke(
      { name: 'count', arguments: { limit: 3 } },
      context,
    );
    expect(result.structuredContent).toEqual({ count: 3 });
    expect(context.ran).toEqual(['count']);
  });

  it('treats absent arguments as none, so a schema can say what is required', async () => {
    const context = fixtureContext();
    const result = await invokerFor().invoke({ name: 'count' }, context);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ count: 0 });
  });

  it('puts a looser argument name right before checking it', async () => {
    const context = fixtureContext();
    const result = await invokerFor().invoke(
      { name: 'rename', arguments: { name: 'a thing' } },
      context,
    );
    expect(textOf(result)).toBe('Renamed a thing.');
  });

  it('wraps one piece of text into the list a tool declared', async () => {
    const context = fixtureContext();
    const result = await invokerFor().invoke(
      { name: 'rename', arguments: { thing: 'x', tags: 'one' } },
      context,
    );
    expect(result.isError).toBeUndefined();
    expect(context.ran).toEqual(['rename']);
  });

  it('refuses arguments that do not fit, naming the problem and what the tool takes', async () => {
    const context = fixtureContext();
    const result = await invokerFor().invoke(
      { name: 'count', arguments: { limit: 99 } },
      context,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid arguments for count');
    expect(textOf(result)).toContain('The arguments are: limit.');
    expect(context.ran).toEqual([]);
  });

  it('lets a tool refuse a call before it runs, reading nothing', async () => {
    const context = fixtureContext({ refuse: true });
    const result = await invokerFor().invoke({ name: 'delete' }, context);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Not allowed just now.');
    expect(context.ran).toEqual([]);
  });

  it('throws for a tool that does not exist', async () => {
    await expect(
      invokerFor().invoke({ name: 'ghost' }, fixtureContext()),
    ).rejects.toBeInstanceOf(UnknownToolError);
  });

  it('throws a malformed request when the call names no tool', async () => {
    for (const params of [undefined, {}, { name: '' }, { name: 7 }]) {
      await expect(
        invokerFor().invoke(params, fixtureContext()),
      ).rejects.toBeInstanceOf(InvalidToolArgumentsError);
    }
  });

  it('throws a malformed request when the arguments are not an object', async () => {
    await expect(
      invokerFor().invoke(
        { name: 'count', arguments: [1, 2] },
        fixtureContext(),
      ),
    ).rejects.toBeInstanceOf(InvalidToolArgumentsError);
  });
});

describe('ToolInvoker.invokeOrExplain', () => {
  it('answers a failing service in words the assistant can relay, keeping the cause to itself', async () => {
    const log = new RecordingLog();
    const invoker = invokerFor([new BrokenTool()], new NoExplanations(), log);
    const result = await invoker.invokeOrExplain(
      { name: 'delete' },
      fixtureContext(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Something went wrong with the database');
    expect(textOf(result)).not.toContain('secret detail');
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]?.service).toBe('the database');
  });

  it('answers a failure the app explains for itself, without logging it as a backend failure', async () => {
    const log = new RecordingLog();
    const explainer: FailureExplainer = {
      explain: (error) =>
        error instanceof Error && error.message === 'a bug'
          ? 'Connect the thing first.'
          : undefined,
    };
    const result = await invokerFor(
      [new BuggyTool()],
      explainer,
      log,
    ).invokeOrExplain(
      { name: 'fetch', arguments: { url: 'x' } },
      fixtureContext(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Connect the thing first.');
    expect(log.entries).toEqual([]);
  });

  it('lets a mistake in our own code escape', async () => {
    await expect(
      invokerFor([new BuggyTool()]).invokeOrExplain(
        { name: 'fetch', arguments: { url: 'x' } },
        fixtureContext(),
      ),
    ).rejects.toThrow('a bug');
  });

  it('lets an unknown tool escape for the router to refuse', async () => {
    await expect(
      invokerFor().invokeOrExplain({ name: 'ghost' }, fixtureContext()),
    ).rejects.toBeInstanceOf(UnknownToolError);
  });
});

describe('ToolInvoker and a tool that names its backing service', () => {
  /** A tool whose work fails the way an unreachable service does. */
  class FlakyTool extends CountTool {
    override readonly backend = 'the archive';

    override async handle(): Promise<never> {
      throw new Error('connection reset');
    }
  }

  /** A tool that names a service but fails at a differently named one. */
  class MisattributedTool extends CountTool {
    override readonly backend = 'the archive';

    override async handle(): Promise<never> {
      throw new BackendFailureError('the mail service', new Error('timeout'));
    }
  }

  it('turns whatever the tool threw into a failure of the service it named', async () => {
    const log = new RecordingLog();
    const result = await invokerFor(
      [new FlakyTool()],
      new NoExplanations(),
      log,
    ).invokeOrExplain({ name: 'count' }, fixtureContext());
    expect(textOf(result)).toContain('Something went wrong with the archive');
    expect(textOf(result)).not.toContain('connection reset');
    expect(log.entries[0]?.service).toBe('the archive');
  });

  it('leaves a failure that already names a service as it is', async () => {
    const log = new RecordingLog();
    await invokerFor(
      [new MisattributedTool()],
      new NoExplanations(),
      log,
    ).invokeOrExplain({ name: 'count' }, fixtureContext());
    expect(log.entries[0]?.service).toBe('the mail service');
  });

  it('lets a tool that named no service fail loudly, so a bug is not hidden', async () => {
    await expect(
      invokerFor([new BuggyTool()]).invokeOrExplain(
        { name: 'fetch', arguments: { url: 'x' } },
        fixtureContext(),
      ),
    ).rejects.toThrow('a bug');
  });
});
