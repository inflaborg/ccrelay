/**
 * Logical hosted tool categories shared across Anthropic Messages and OpenAI Chat/Responses wire.
 */

/** Wire-level hosted tool categories recognized across protocols. */
export type HostedToolKind = "web_search" | "code_interpreter" | "text_editor";

export interface HostedToolMatcher {
  kind: HostedToolKind;
  /** Match Chat Completions / Responses `tools[].type` string. */
  matchChatType: (typ: string) => boolean;
  /** Match Anthropic Messages `tools[]` entry (`type` + `name`). */
  matchAnthropicTool: (tool: Record<string, unknown>) => boolean;
}
