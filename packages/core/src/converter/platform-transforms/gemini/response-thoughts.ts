/**
 * Gemini OpenAI-compat: after generic OpenAI→Anthropic conversion, split a leading
 * `<thought>...</thought>` prefix in assistant string `content` into Anthropic
 * `thinking` + `text` blocks (when `include_thoughts` is enabled via `extra_body`).
 * Also maps Gemini-native `thought_signature` on tool calls into Anthropic thinking blocks.
 */

import type {
  AnthropicContentBlock,
  AnthropicThinkingBlock,
} from "../../adapters/openai-chat-to-anthropic-response";

function isThinkingBlock(b: AnthropicContentBlock | undefined): b is AnthropicThinkingBlock {
  return b !== undefined && b.type === "thinking";
}

function parseThoughtTags(content: string): { thought?: string; text: string } {
  const match = content.match(/^<thought>([\s\S]*?)<\/thought>([\s\S]*)$/);
  if (!match) {
    return { text: content };
  }
  return {
    thought: match[1].trim(),
    text: match[2].trim(),
  };
}

function getOpenAiMessageFromBody(
  body: Record<string, unknown>
): Record<string, unknown> | undefined {
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  const c0 = choices[0] as Record<string, unknown> | undefined;
  const msg = c0?.message;
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return undefined;
  }
  return msg as Record<string, unknown>;
}

function getMessageContent(body: Record<string, unknown>): string | undefined {
  const msg = getOpenAiMessageFromBody(body);
  if (!msg) {
    return undefined;
  }
  const content = msg.content;
  return typeof content === "string" ? content : undefined;
}

function extractThoughtSignatureFromBody(body: Record<string, unknown>): string | undefined {
  const message = getOpenAiMessageFromBody(body);
  if (!message) {
    return undefined;
  }
  const thinking = message.thinking as Record<string, unknown> | undefined;
  if (typeof thinking?.signature === "string" && thinking.signature.length > 0) {
    return thinking.signature;
  }
  const toolCalls = message.tool_calls as Record<string, unknown>[] | undefined;
  if (!Array.isArray(toolCalls)) {
    return undefined;
  }
  for (const tc of toolCalls) {
    const ex = tc?.extra_content as Record<string, unknown> | undefined;
    const g = ex?.google as Record<string, unknown> | undefined;
    if (typeof g?.thought_signature === "string" && g.thought_signature.length > 0) {
      return g.thought_signature;
    }
    const fn = tc?.function as Record<string, unknown> | undefined;
    if (typeof fn?.thought_signature === "string" && fn.thought_signature.length > 0) {
      return fn.thought_signature;
    }
  }
  return undefined;
}

function extractThinkingBodyFromOpenAiBody(body: Record<string, unknown>): string {
  const message = getOpenAiMessageFromBody(body);
  if (!message) {
    return "";
  }
  const thinking = message.thinking as Record<string, unknown> | undefined;
  const fromThinking = thinking?.content;
  if (typeof fromThinking === "string" && fromThinking.length > 0) {
    return fromThinking;
  }
  const rc = message.reasoning_content;
  if (typeof rc === "string" && rc.length > 0) {
    return rc;
  }
  return typeof fromThinking === "string" ? fromThinking : "";
}

/**
 * When the generic adapter omitted Gemini wire signatures, copy `thought_signature`
 * from tool calls (or keep message.thinking path) onto Anthropic thinking blocks.
 */
function patchThoughtSignatureFromToolCallsIntoBlocks(
  openaiBody: Record<string, unknown>,
  blocks: AnthropicContentBlock[]
): AnthropicContentBlock[] {
  const sig = extractThoughtSignatureFromBody(openaiBody);
  if (sig === undefined) {
    return blocks;
  }
  const thinkingIdx = blocks.findIndex(b => b.type === "thinking");
  if (thinkingIdx >= 0) {
    const tb = blocks[thinkingIdx] as AnthropicThinkingBlock;
    const hasSig = typeof tb.signature === "string" && tb.signature.length > 0;
    if (hasSig) {
      return blocks;
    }
    const next = blocks.slice();
    next[thinkingIdx] = { ...tb, signature: sig };
    return next;
  }
  const thinkingBody = extractThinkingBodyFromOpenAiBody(openaiBody);
  return [{ type: "thinking", thinking: thinkingBody, signature: sig }, ...blocks];
}

export function geminiThoughtTagsResponseTransform(
  openaiBody: Record<string, unknown>,
  anthropicBlocks: AnthropicContentBlock[]
): AnthropicContentBlock[] {
  const blocks = patchThoughtSignatureFromToolCallsIntoBlocks(openaiBody, anthropicBlocks);

  const raw = getMessageContent(openaiBody);
  if (raw === undefined || raw === "") {
    return blocks;
  }

  const parsed = parseThoughtTags(raw);
  if (!parsed.thought || parsed.thought.length === 0) {
    return blocks;
  }

  const textIdx = blocks.findIndex(b => b.type === "text" && b.text === raw);
  if (textIdx === -1) {
    return blocks;
  }

  const prev = textIdx > 0 ? blocks[textIdx - 1] : undefined;
  if (isThinkingBlock(prev)) {
    if (typeof prev.thinking === "string" && prev.thinking.trim().length > 0) {
      return blocks;
    }
  }

  const sigFromBody = extractThoughtSignatureFromBody(openaiBody);

  const head =
    isThinkingBlock(prev) && textIdx > 0 ? blocks.slice(0, textIdx - 1) : blocks.slice(0, textIdx);

  let newThinking: AnthropicThinkingBlock;
  if (isThinkingBlock(prev)) {
    newThinking = {
      type: "thinking",
      thinking: parsed.thought,
      ...(prev.signature !== undefined || sigFromBody !== undefined
        ? { signature: prev.signature ?? sigFromBody }
        : {}),
    };
  } else {
    newThinking = {
      type: "thinking",
      thinking: parsed.thought,
      ...(sigFromBody !== undefined ? { signature: sigFromBody } : {}),
    };
  }

  const mid: AnthropicContentBlock[] = [];
  if (parsed.text.length > 0) {
    mid.push({ type: "text", text: parsed.text });
  }

  const tail = blocks.slice(textIdx + 1);
  const hasToolsInTail = tail.some(b => b.type === "tool_use");
  const needsEmptyTextBeforeTools = hasToolsInTail && mid.length === 0 && parsed.text.length === 0;

  if (needsEmptyTextBeforeTools) {
    return [...head, newThinking, { type: "text", text: "" }, ...tail];
  }

  return [...head, newThinking, ...mid, ...tail];
}
