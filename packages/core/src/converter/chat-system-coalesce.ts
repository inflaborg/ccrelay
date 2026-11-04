/**
 * Collapse Chat Completions `system` / `developer` messages into one leading system.
 * Used when a provider rejects system messages that are duplicated or not first.
 */

import type { OpenAIContent, OpenAIMessage } from "./adapters/anthropic-to-openai-chat-request";

function isSystemLike(msg: OpenAIMessage): boolean {
  return msg.role === "system" || msg.role === "developer";
}

function textOf(part: OpenAIContent): string | undefined {
  if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) {
    return part.text;
  }
  return undefined;
}

/** True when the message has no text and no image. */
function isEmptySystem(msg: OpenAIMessage): boolean {
  const content = msg.content;
  if (typeof content === "string") {
    return content.trim().length === 0;
  }
  if (!Array.isArray(content) || content.length === 0) {
    return true;
  }
  return !content.some(part => {
    if (!part || typeof part !== "object") {
      return false;
    }
    if (textOf(part) !== undefined) {
      return true;
    }
    return part.type === "image_url";
  });
}

/**
 * Ordered text (joined with `\n` inside one message) and images from one system message.
 */
function segmentsOf(msg: OpenAIMessage): OpenAIContent[] {
  const content = msg.content;
  if (typeof content === "string") {
    return content.trim().length > 0 ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const out: OpenAIContent[] = [];
  let pending = "";
  const flush = () => {
    if (pending.length > 0) {
      out.push({ type: "text", text: pending });
      pending = "";
    }
  };

  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const text = textOf(part);
    if (text !== undefined) {
      pending = pending.length > 0 ? `${pending}\n${text}` : text;
      continue;
    }
    if (part.type === "image_url") {
      flush();
      out.push(part);
    }
  }
  flush();
  return out;
}

function mergeSystemContent(messages: OpenAIMessage[]): string | OpenAIContent[] | undefined {
  const parts: OpenAIContent[] = [];
  for (const msg of messages) {
    for (const part of segmentsOf(msg)) {
      const prev = parts[parts.length - 1];
      if (part.type === "text" && prev?.type === "text") {
        prev.text = `${prev.text}\n\n${part.text}`;
        continue;
      }
      parts.push(part.type === "text" ? { type: "text", text: part.text } : { ...part });
    }
  }
  if (parts.length === 0) {
    return undefined;
  }
  if (parts.length === 1 && parts[0]?.type === "text") {
    return parts[0].text;
  }
  return parts;
}

function asSystem(msg: OpenAIMessage): OpenAIMessage {
  return msg.role === "system" ? msg : { ...msg, role: "system" };
}

/**
 * Move every `system` and `developer` message into a single `system` at index 0.
 * A body that already has exactly one leading `system` is returned unchanged.
 * Empty system messages are dropped. No system message is invented when none remain.
 */
export function coalesceLeadingSystemMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
  const systems: OpenAIMessage[] = [];
  const rest: OpenAIMessage[] = [];
  for (const msg of messages) {
    if (msg && typeof msg === "object" && isSystemLike(msg)) {
      systems.push(msg);
    } else {
      rest.push(msg);
    }
  }

  if (systems.length === 0) {
    return messages;
  }

  const first = messages[0];
  if (systems.length === 1 && first === systems[0] && first.role === "system") {
    return messages;
  }

  const meaningful = systems.filter(msg => !isEmptySystem(msg));
  if (meaningful.length === 0) {
    return rest;
  }
  if (meaningful.length === 1) {
    const only = meaningful[0];
    if (!only) {
      return rest;
    }
    return [asSystem(only), ...rest];
  }

  const content = mergeSystemContent(meaningful);
  if (content === undefined) {
    return rest;
  }
  return [{ role: "system", content }, ...rest];
}
