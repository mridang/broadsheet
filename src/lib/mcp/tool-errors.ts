/**
 * @packageDocumentation
 *
 * The two ways a `tools/call` can be refused as a *protocol* error (a JSON-RPC
 * `-32602`), as opposed to a tool that ran and reports a problem in its result,
 * plus {@link BackendFailureError} for a dependency that broke mid-call (which is
 * reported in the result, not as a protocol error). The tool code throws these;
 * the request router turns them into the response, so neither side needs to
 * know about the other's internals.
 */

/** The caller named a tool this server does not have. */
export class UnknownToolError extends Error {
  override readonly name = 'UnknownToolError';

  /** @param tool - The name the caller used. */
  constructor(readonly tool: string) {
    super(`Unknown tool: ${tool}`);
  }
}

/** The caller's arguments do not fit the tool's input schema. */
export class InvalidToolArgumentsError extends Error {
  override readonly name = 'InvalidToolArgumentsError';

  /** @param problems - What is wrong, one problem per entry, written for the caller. */
  constructor(readonly problems: readonly string[]) {
    super(`Invalid arguments: ${problems.join(' ')}`);
  }
}

/**
 * Something a tool depends on (Google Drive, the database, the AI model) failed
 * while the tool was running. Unlike the two errors above this is not a protocol
 * error: the assistant asked for something valid and can relay "try again in a
 * minute" to the person, so the router turns it into an `isError` result. What
 * actually went wrong travels in `cause` for the logs and never reaches the
 * assistant.
 */
export class BackendFailureError extends Error {
  override readonly name = 'BackendFailureError';

  /**
   * @param service - Which dependency failed, in words that fit a sentence
   * ("Google Drive").
   * @param cause - What the dependency threw.
   */
  constructor(
    readonly service: string,
    cause: unknown,
  ) {
    super(`${service} failed`, { cause });
  }
}
