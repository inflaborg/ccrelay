/**
 * GLM outbound: flatten Chat `messages[].content` when it is a text-only parts array.
 */

import type { OpenAIMessage } from "../../adapters/anthropic-to-openai-chat-request";

function isOpenAiTextPart(part: unknown): part is { type: "text"; text: string } {
  if (!part || typeof part !== "object" || Array.isArray(part)) {
    return false;
  }
  const o = part as Record<string, unknown>;
  return o.type === "text" && "text" in o && typeof o.text === "string";
}

/** Join text-only multi-part `content` into a single string for each message where applicable. */
export function glmFlattenContentTransform(messages: OpenAIMessage[]): OpenAIMessage[] {
  return messages.map(msg => {
    const content = msg.content;
    if (!Array.isArray(content)) {
      return msg;
    }
    if (!content.every(isOpenAiTextPart)) {
      return msg;
    }
    const joined = content
      .map(p => p.text)
      .filter(Boolean)
      .join("\n");
    return { ...msg, content: joined };
  });
}
