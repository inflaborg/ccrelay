/**
 * Hoist inline `messages` system/developer entries into top-level `system` for models
 * that reject `role: system` inside the messages array (e.g. Claude Haiku).
 */

/* eslint-disable @typescript-eslint/naming-convention -- Anthropic Messages API wire fields */

type AnthropicSystemTextBlock = {
  type: "text";
  text: string;
  cache_control?: { type: string; ttl?: string };
};

function isSystemRole(role: unknown): boolean {
  return role === "system" || role === "developer";
}

function contentToSystemBlocks(content: unknown): AnthropicSystemTextBlock[] {
  if (typeof content === "string" && content.length > 0) {
    return [{ type: "text", text: content }];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  const blocks: AnthropicSystemTextBlock[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      continue;
    }
    const p = part as Record<string, unknown>;
    if (p.type !== "text" || typeof p.text !== "string" || p.text.length === 0) {
      continue;
    }
    const block: AnthropicSystemTextBlock = { type: "text", text: p.text };
    const cc = p.cache_control;
    if (cc && typeof cc === "object" && !Array.isArray(cc)) {
      const c = cc as Record<string, unknown>;
      if (typeof c.type === "string") {
        block.cache_control = {
          type: c.type,
          ...(typeof c.ttl === "string" ? { ttl: c.ttl } : {}),
        };
      }
    }
    blocks.push(block);
  }
  return blocks;
}

function existingSystemToBlocks(system: unknown): AnthropicSystemTextBlock[] {
  if (typeof system === "string") {
    return system.length > 0 ? [{ type: "text", text: system }] : [];
  }
  if (!Array.isArray(system)) {
    return [];
  }
  const blocks: AnthropicSystemTextBlock[] = [];
  for (const entry of system) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const e = entry as Record<string, unknown>;
    if (e.type !== "text" || typeof e.text !== "string" || e.text.length === 0) {
      continue;
    }
    const block: AnthropicSystemTextBlock = { type: "text", text: e.text };
    const cc = e.cache_control;
    if (cc && typeof cc === "object" && !Array.isArray(cc)) {
      const c = cc as Record<string, unknown>;
      if (typeof c.type === "string") {
        block.cache_control = {
          type: c.type,
          ...(typeof c.ttl === "string" ? { ttl: c.ttl } : {}),
        };
      }
    }
    blocks.push(block);
  }
  return blocks;
}

function blocksToSystemField(
  blocks: AnthropicSystemTextBlock[]
): string | AnthropicSystemTextBlock[] {
  if (blocks.length === 0) {
    return [];
  }
  if (blocks.length === 1 && !blocks[0].cache_control) {
    return blocks[0].text;
  }
  return blocks;
}

/**
 * Hoist `messages` entries with role system/developer into top-level `system`.
 * Mutates `data` in place. Returns true when messages were changed.
 */
export function hoistInlineSystemMessagesToAnthropicSystem(data: Record<string, unknown>): boolean {
  const messages = data.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }

  const rest: unknown[] = [];
  const hoistedBlocks: AnthropicSystemTextBlock[] = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      rest.push(msg);
      continue;
    }
    const m = msg as Record<string, unknown>;
    if (!isSystemRole(m.role)) {
      rest.push(msg);
      continue;
    }
    hoistedBlocks.push(...contentToSystemBlocks(m.content));
  }

  if (hoistedBlocks.length === 0) {
    return false;
  }

  const merged = [...existingSystemToBlocks(data.system), ...hoistedBlocks];
  data.system = blocksToSystemField(merged);
  data.messages = rest;
  return true;
}
