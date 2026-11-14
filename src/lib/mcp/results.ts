/**
 * @packageDocumentation
 *
 * What a tool call hands back to the assistant: text for the model to read and,
 * where a tool has an output schema, the structured data that text was built
 * from. The text carries the data too, because a host may show the model only
 * the text.
 *
 * {@link ToolResult} is generic over the structured content an app's tools
 * return, so an app that draws its results in a view can give that content its
 * own type and still be checked against the tool's output schema. An app that
 * returns plain JSON objects need not say anything.
 */

/** One piece of text in a tool result. */
export interface TextContent {
  readonly type: 'text';
  readonly text: string;
}

/** Structured content with no shape of its own. */
export type JsonContent = Readonly<Record<string, unknown>>;

/**
 * The result of a `tools/call`, as the protocol wants it.
 *
 * `TContent` is the shape of the structured content, which an app may narrow to
 * the views its tools draw.
 */
export interface ToolResult<TContent = JsonContent> {
  /** What the model reads. */
  readonly content: readonly TextContent[];
  /** The data the text was built from, for the tools that have a schema for it. */
  readonly structuredContent?: TContent;
  /**
   * What a host needs to show this particular result, such as which view to
   * draw it with. What a tool always carries belongs in its catalogue entry
   * instead.
   */
  readonly _meta?: Readonly<Record<string, string>>;
  /** True when the call failed in a way the assistant should relay. */
  readonly isError?: boolean;
}

/**
 * A plain-text result.
 * @param body - What the model reads.
 */
export function textResult(body: string): ToolResult<never> {
  return { content: [{ type: 'text', text: body }] };
}

/**
 * A plain-text result that tells the assistant the call did not work.
 * @param body - What went wrong, in words the assistant can act on or relay.
 */
export function errorResult(body: string): ToolResult<never> {
  return { ...textResult(body), isError: true };
}

/**
 * A result that carries its data both as text and as structured content.
 * @param body - What the model reads.
 * @param data - The same facts, shaped by the tool's output schema.
 * @param meta - What a host needs to draw this result, where it needs anything.
 */
export function dataResult<TContent>(
  body: string,
  data: TContent,
  meta?: Readonly<Record<string, string>>,
): ToolResult<TContent> {
  return {
    ...textResult(body),
    structuredContent: data,
    ...(meta === undefined ? {} : { _meta: meta }),
  };
}
