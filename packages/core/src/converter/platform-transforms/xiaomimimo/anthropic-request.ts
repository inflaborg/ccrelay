/**
 * Xiaomi MiMo Anthropic-compatible endpoint: sanitize passthrough `/v1/messages` bodies.
 *
 * Claude Agent SDK emits `role: "system"` entries inside `messages[]` (e.g. injected skill
 * listings). Real Anthropic tolerates this, but MiMo validates strictly and rejects with
 * `messages[i].role must be either 'user' or 'assistant'`. Rewrite those entries to `user`
 * and merge adjacent same-role messages so MiMo's alternation check still passes.
 */

import { isPlainObject } from "../passthrough";

/** Normalize Anthropic message `content` (string or block array) into a block array for merging. */
function toContentBlocks(content: unknown): unknown[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (Array.isArray(content)) {
    return content;
  }
  return [];
}

/** Concatenate two messages' content into a single block array. */
function mergeContent(prev: unknown, cur: unknown): unknown[] {
  return [...toContentBlocks(prev), ...toContentBlocks(cur)];
}

export function mimoAnthropicRequestSanitize(body: Record<string, unknown>): void {
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return;
  }

  let rewroteSystem = false;
  for (const m of messages) {
    if (isPlainObject(m) && m.role === "system") {
      m.role = "user";
      rewroteSystem = true;
    }
  }
  if (!rewroteSystem) {
    return;
  }

  const merged: unknown[] = [];
  for (const raw of messages) {
    if (!isPlainObject(raw)) {
      merged.push(raw);
      continue;
    }
    const prev = merged[merged.length - 1];
    if (isPlainObject(prev) && prev.role === raw.role) {
      prev.content = mergeContent(prev.content, raw.content);
      continue;
    }
    merged.push({ ...raw });
  }
  body.messages = merged;
}
