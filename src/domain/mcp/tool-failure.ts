/**
 * @packageDocumentation
 *
 * What a tool or a resource raises when it cannot do what was asked.
 *
 * It is not a protocol error and not a bug: the arguments fitted, the work ran,
 * and the answer is that it could not be done. The message is for the assistant
 * to act on or relay, so it says what was wrong in words rather than naming
 * internals.
 */

/** An outcome the assistant can read and act on. */
export class ToolFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolFailureError';
  }
}
