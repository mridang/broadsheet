/**
 * @packageDocumentation
 *
 * Running a `tools/call`.
 *
 * An invoker finds the tool a call names, checks the call against that tool's
 * own schema, gives the tool a chance to refuse the call outright, and then
 * runs it. A tool that named one backing service has whatever it throws turned
 * into a failure of that service, so it need not wrap its own work. It knows nothing about any individual tool, so it is the same code
 * whatever the tool set is: a tool that needs something slow opens it through
 * the context when it asks, which is why there is no list of tools to treat
 * differently here.
 */

import { ArgumentChecker } from './arguments';
import type { FailureExplainer } from './failures';
import { errorResult, type JsonContent, type ToolResult } from './results';
import type { ToolRegistry } from './registry';
import {
  BackendFailureError,
  InvalidToolArgumentsError,
  UnknownToolError,
} from './tool-errors';
import type { ToolArgs } from './tool';

/** Somewhere to record a failure that is not shown to the assistant. */
export interface FailureLog {
  /**
   * Record that a service a tool depends on failed.
   * @param service - What failed, in the words the assistant is given.
   * @param cause - What actually failed, which may hold details that must not
   *   travel on to an assistant.
   */
  record(service: string, cause: unknown): void;
}

/** What {@link ToolInvoker} needs to run a call. */
export interface ToolInvokerOptions<
  TName extends string,
  TContext,
  TContent = JsonContent,
> {
  /** The tools the server offers. */
  readonly registry: ToolRegistry<TName, TContext, TContent>;
  /** Which failures this app explains to an assistant, and how. */
  readonly failures: FailureExplainer;
  /** Where a backend failure is recorded before it is explained away. */
  readonly log: FailureLog;
}

/**
 * Runs a `tools/call` against a registry.
 *
 * {@link invoke} answers the call or throws for the router to turn into a
 * protocol error. {@link invokeOrExplain} is the same, except that the failures
 * an assistant can act on come back as results it can relay.
 */
export class ToolInvoker<
  TName extends string,
  TContext,
  TContent = JsonContent,
> {
  readonly #registry: ToolRegistry<TName, TContext, TContent>;
  readonly #failures: FailureExplainer;
  readonly #log: FailureLog;
  readonly #checker = new ArgumentChecker();

  constructor(options: ToolInvokerOptions<TName, TContext, TContent>) {
    this.#registry = options.registry;
    this.#failures = options.failures;
    this.#log = options.log;
  }

  /**
   * Run a call.
   * @param params - The `params` of the `tools/call` request, untrusted.
   * @param context - What the app hands its tools.
   * @returns The tool's result, or an `isError` result saying what to change
   *   when the arguments do not fit or the tool refused the call. Nothing is
   *   opened or read for those.
   * @throws {UnknownToolError} If no tool has that name.
   * @throws {InvalidToolArgumentsError} If the request names no tool, or its
   *   `arguments` is not an object: both are malformed requests.
   */
  async invoke(
    params: ToolArgs | undefined,
    context: TContext,
  ): Promise<ToolResult<TContent>> {
    const name: unknown = params?.['name'];
    if (typeof name !== 'string' || name === '') {
      throw new InvalidToolArgumentsError([
        '`name` must be the name of a tool.',
      ]);
    }
    const tool = this.#registry.named(name);
    if (!tool) {
      throw new UnknownToolError(name);
    }
    const checked = this.#checker.check(tool, params?.['arguments']);
    if (checked.refusal) {
      return checked.refusal;
    }
    const refusal = await tool.precheck(context);
    if (refusal) {
      return refusal;
    }
    if (tool.backend === undefined) {
      return tool.handle(checked.args, context);
    }
    try {
      return await tool.handle(checked.args, context);
    } catch (error) {
      throw error instanceof BackendFailureError
        ? error
        : new BackendFailureError(tool.backend, error);
    }
  }

  /**
   * Run a call, explaining the failures an assistant can act on instead of
   * throwing them. An unknown tool or a malformed request is still thrown, for
   * the router to answer as a protocol error.
   *
   * A failure of a named service is always recorded, and the app may word what
   * the assistant is told about it; everything else is explained only if the
   * app recognises it, and is otherwise thrown on.
   * @param params - The `params` of the `tools/call` request, untrusted.
   * @param context - What the app hands its tools.
   */
  async invokeOrExplain(
    params: ToolArgs | undefined,
    context: TContext,
  ): Promise<ToolResult<TContent>> {
    try {
      return await this.invoke(params, context);
    } catch (error) {
      if (error instanceof BackendFailureError) {
        this.#log.record(error.service, error.cause);
        return errorResult(
          this.#failures.explain(error) ??
            `Something went wrong with ${error.service}, so that did not work. Try again in a minute; if it keeps failing, tell the user.`,
        );
      }
      const explained = this.#failures.explain(error);
      if (explained === undefined) {
        throw error;
      }
      return errorResult(explained);
    }
  }
}
