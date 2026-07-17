import { ScopedLogger } from "../../utils/logger";
import { hoistInlineSystemMessagesToAnthropicSystem } from "./normalize-anthropic-system";
import { resolveModelMeta } from "./registry";
import type { ModelMeta } from "./types";

const log = new ScopedLogger("ModelMeta");

const DEFERRED_TOOL_PLACEHOLDER = "DeferredToolPlaceholder";

function deleteOutputConfigEffort(data: Record<string, unknown>, changes: string[]): void {
  const oc = data.output_config;
  if (!oc || typeof oc !== "object" || Array.isArray(oc)) {
    return;
  }
  const out = oc as Record<string, unknown>;
  if ("effort" in out) {
    delete out.effort;
    changes.push("output_config.effort");
  }
  if (Object.keys(out).length === 0) {
    delete data.output_config;
    changes.push("output_config");
  }
}

function normalizeThinkingForMeta(
  data: Record<string, unknown>,
  meta: ModelMeta,
  changes: string[]
): void {
  const reasoning = meta.reasoning;
  const thinking = data.thinking;
  if (thinking && typeof thinking === "object" && !Array.isArray(thinking)) {
    const t = thinking as Record<string, unknown>;
    const type = typeof t.type === "string" ? t.type.toLowerCase() : "";

    if (!reasoning.supportsThinking) {
      delete data.thinking;
      changes.push("thinking");
    } else if (!reasoning.supportsAdaptiveThinking && type === "adaptive") {
      if (reasoning.mapAdaptiveThinkingToEnabled) {
        t.type = "enabled";
        delete t.budget_tokens;
        changes.push("thinking.adaptive->enabled");
      } else {
        delete data.thinking;
        changes.push("thinking");
      }
    }
  } else if (!reasoning.supportsThinking && data.thinking !== undefined) {
    delete data.thinking;
    changes.push("thinking");
  }
}

function stripContextManagement(data: Record<string, unknown>, changes: string[]): void {
  if (data.context_management !== undefined) {
    delete data.context_management;
    changes.push("context_management");
  }
}

function stripDeferLoadingFromTools(data: Record<string, unknown>, changes: string[]): void {
  const tools = data.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    return;
  }

  const next: unknown[] = [];
  let changed = false;

  for (const tool of tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      next.push(tool);
      continue;
    }
    const t = tool as Record<string, unknown>;
    if (t.name === DEFERRED_TOOL_PLACEHOLDER) {
      changed = true;
      continue;
    }
    if ("defer_loading" in t) {
      const copy = { ...t };
      delete copy.defer_loading;
      next.push(copy);
      changed = true;
      continue;
    }
    next.push(tool);
  }

  if (changed) {
    data.tools = next;
    changes.push("tools.defer_loading");
  }
}

function stripExtendedCacheTtlFromBlock(block: Record<string, unknown>): boolean {
  const cc = block.cache_control;
  if (!cc || typeof cc !== "object" || Array.isArray(cc)) {
    return false;
  }
  const control = cc as Record<string, unknown>;
  if (!("ttl" in control)) {
    return false;
  }
  delete control.ttl;
  if (Object.keys(control).length === 0) {
    delete block.cache_control;
  }
  return true;
}

function stripExtendedCacheTtlFromContent(content: unknown): boolean {
  if (!Array.isArray(content)) {
    return false;
  }
  let changed = false;
  for (const part of content) {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      continue;
    }
    if (stripExtendedCacheTtlFromBlock(part as Record<string, unknown>)) {
      changed = true;
    }
  }
  return changed;
}

function stripExtendedCacheTtlFromSystem(system: unknown): boolean {
  if (Array.isArray(system)) {
    let changed = false;
    for (const block of system) {
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        continue;
      }
      if (stripExtendedCacheTtlFromBlock(block as Record<string, unknown>)) {
        changed = true;
      }
    }
    return changed;
  }
  return false;
}

function stripExtendedCacheTtlFromMessages(messages: unknown): boolean {
  if (!Array.isArray(messages)) {
    return false;
  }
  let changed = false;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      continue;
    }
    const m = msg as Record<string, unknown>;
    if (stripExtendedCacheTtlFromContent(m.content)) {
      changed = true;
    }
  }
  return changed;
}

function stripExtendedCacheTtl(data: Record<string, unknown>, changes: string[]): void {
  const systemChanged = stripExtendedCacheTtlFromSystem(data.system);
  const messagesChanged = stripExtendedCacheTtlFromMessages(data.messages);
  if (systemChanged || messagesChanged) {
    changes.push("cache_control.ttl");
  }
}

function rewriteToolReferenceBlock(block: Record<string, unknown>): Record<string, unknown> {
  const toolName =
    typeof block.tool_name === "string" && block.tool_name.length > 0 ? block.tool_name : "unknown";
  return { type: "text", text: `Tool loaded: ${toolName}.` };
}

function normalizeToolReferenceBlocksInContent(content: unknown): {
  content: unknown;
  changed: boolean;
} {
  if (!Array.isArray(content)) {
    return { content, changed: false };
  }

  let changed = false;
  const next: unknown[] = content.map((part: unknown) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      return part;
    }
    const block = part as Record<string, unknown>;
    if (block.type === "tool_reference") {
      changed = true;
      return rewriteToolReferenceBlock(block);
    }
    if (block.type === "tool_result" && block.content !== undefined) {
      const nested = normalizeToolReferenceBlocksInContent(block.content);
      if (nested.changed) {
        changed = true;
        return { ...block, content: nested.content };
      }
    }
    return part;
  });

  return { content: changed ? next : content, changed };
}

function normalizeToolReferenceBlocksInMessages(messages: unknown): boolean {
  if (!Array.isArray(messages)) {
    return false;
  }

  let changed = false;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      continue;
    }
    const m = msg as Record<string, unknown>;
    const normalized = normalizeToolReferenceBlocksInContent(m.content);
    if (normalized.changed) {
      m.content = normalized.content;
      changed = true;
    }
  }
  return changed;
}

function normalizeToolReferenceBlocks(data: Record<string, unknown>, changes: string[]): void {
  if (normalizeToolReferenceBlocksInMessages(data.messages)) {
    changes.push("tool_reference");
  }
}

function resolveSanitizeModelMeta(model: string): ModelMeta {
  const direct = resolveModelMeta(model);
  if (direct.id !== "unknown") {
    return direct;
  }
  return resolveModelMeta(model, { vendor: "anthropic" });
}

/**
 * Strip Anthropic Messages API fields unsupported by the resolved model meta.
 * Mutates `data` in place; returns field paths removed for logging.
 */
export function sanitizeAnthropicRequestByMeta(
  data: Record<string, unknown>,
  meta: ModelMeta
): string[] {
  const changes: string[] = [];
  const reasoning = meta.reasoning;
  const anthropic = meta.anthropic;

  if (!reasoning.supportsEffort) {
    deleteOutputConfigEffort(data, changes);
  }

  normalizeThinkingForMeta(data, meta, changes);

  if (anthropic?.supportsSystemRoleInMessages === false) {
    if (hoistInlineSystemMessagesToAnthropicSystem(data)) {
      changes.push("messages.system->system");
    }
  }

  if (anthropic?.supportsContextManagement === false) {
    stripContextManagement(data, changes);
  }

  if (anthropic?.supportsDeferLoading === false) {
    stripDeferLoadingFromTools(data, changes);
  }

  if (anthropic?.supportsToolReferenceBlocks === false) {
    normalizeToolReferenceBlocks(data, changes);
  }

  if (anthropic?.supportsExtendedCacheTtl === false) {
    stripExtendedCacheTtl(data, changes);
  }

  if (changes.length > 0) {
    const modelLabel = typeof data.model === "string" ? data.model : "?";
    log.warn(
      `[model-meta] sanitized ${changes.join(", ")} for ${modelLabel} ` +
        `(family=${meta.id}, vendor=${meta.vendor})`
    );
  }

  return changes;
}

/** Resolve meta from `data.model` and sanitize in place. */
export function sanitizeAnthropicRequestRecord(data: Record<string, unknown>): void {
  const model = typeof data.model === "string" ? data.model : "";
  const meta = resolveSanitizeModelMeta(model);
  sanitizeAnthropicRequestByMeta(data, meta);
}
