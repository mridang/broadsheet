/**
 * @packageDocumentation
 *
 * Checking the arguments of a tool call before anything runs.
 *
 * Arguments arrive as untrusted JSON. A check has three parts: the envelope has
 * to be an object at all, the looser spellings the tool forgives are put right,
 * and what is left is measured against the tool's own input schema. The first
 * is a malformed request and is thrown; the third is a mistake an assistant can
 * correct and comes back as a refusal naming each problem.
 */

import { describeArguments, isJsonObject, validateJson } from './json-schema';
import { InvalidToolArgumentsError } from './tool-errors';
import { errorResult, type ToolResult } from './results';
import { canonicalArguments } from './tool-args';
import type { AnyMcpTool, ToolArgs } from './tool';

/** Arguments that fit the schema, or the refusal to answer with instead. */
export type CheckedArguments =
  | { readonly args: ToolArgs; readonly refusal?: undefined }
  | { readonly args?: undefined; readonly refusal: ToolResult<never> };

/**
 * Measures a call's arguments against the tool it names.
 *
 * The MCP specification files input validation under tool execution errors
 * rather than protocol errors, so that a host shows the model what to correct;
 * a refusal from here is therefore an `isError` result rather than a throw.
 */
export class ArgumentChecker {
  /**
   * Check the arguments of one call.
   *
   * Omitted arguments count as none, so a schema can say what is required.
   * When both an alias and its canonical name are present nothing is renamed
   * and the schema refuses the alias, because guessing which the caller meant
   * would be worse than saying so.
   * @param tool - The tool the call named.
   * @param rawArgs - The `arguments` of the call, untrusted.
   * @returns The corrected arguments, or the refusal to answer with.
   * @throws {InvalidToolArgumentsError} If `arguments` is not an object at all,
   *   which is a malformed request rather than a mistaken call.
   */
  check(tool: AnyMcpTool, rawArgs: unknown): CheckedArguments {
    const given = rawArgs === undefined ? {} : rawArgs;
    if (!isJsonObject(given)) {
      throw new InvalidToolArgumentsError(['`arguments` must be an object.']);
    }
    const args = canonicalArguments(given, tool.spellings);
    const problems = validateJson(tool.inputSchema, args, 'The arguments');
    if (problems.length === 0) {
      return { args };
    }
    return {
      refusal: errorResult(
        `Invalid arguments for ${tool.name}: ${problems.join(' ')} ${describeArguments(tool.inputSchema)}`,
      ),
    };
  }
}
