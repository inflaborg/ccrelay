/**
 * MiniMax OpenAI Chat Completions: map `reasoning_details` into Anthropic `thinking` blocks.
 * Runs after generic OpenAI→Anthropic conversion; prepends `thinking` when the upstream
 * message carries `reasoning_details` (with `reasoning_split: true` on the request).
 */

import type {
  AnthropicContentBlock,
  AnthropicThinkingBlock,
} from "../../adapters/openai-chat-to-anthropic-response";

function asRecord(val: unknown): Record<string, unknown> | undefined {
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    return undefined;
  }
  return val as Record<string, unknown>;
}

function collectReasoningDetailsText(body: Record<string, unknown>): string {
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }
  const choice0 = asRecord(choices[0]);
  if (!choice0) {
    return "";
  }
  const message = asRecord(choice0.message);
  if (!message) {
    return "";
  }
  const details = message.reasoning_details;
  if (!Array.isArray(details) || details.length === 0) {
    return "";
  }
  const parts: string[] = [];
  for (const item of details) {
    const o = asRecord(item);
    if (!o) {
      continue;
    }
    const t = o.text;
    if (typeof t === "string" && t.length > 0) {
      parts.push(t);
    }
  }
  return parts.join("\n\n");
}

function hasThinkingBlock(blocks: AnthropicContentBlock[]): boolean {
  return blocks.some(b => b.type === "thinking");
}

/** Prepend `thinking` from MiniMax `reasoning_details` when present and not already converted. */
export function minimaxReasoningDetailsResponseTransform(
  openaiCompletionBody: Record<string, unknown>,
  anthropicBlocks: AnthropicContentBlock[]
): AnthropicContentBlock[] {
  if (hasThinkingBlock(anthropicBlocks)) {
    return anthropicBlocks;
  }
  const joined = collectReasoningDetailsText(openaiCompletionBody);
  if (!joined) {
    return anthropicBlocks;
  }
  const thinking: AnthropicThinkingBlock = { type: "thinking", thinking: joined };
  return [thinking, ...anthropicBlocks];
}
