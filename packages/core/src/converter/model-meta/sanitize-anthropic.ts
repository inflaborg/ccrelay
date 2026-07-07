import { ScopedLogger } from "../../utils/logger";
import { hoistInlineSystemMessagesToAnthropicSystem } from "./normalize-anthropic-system";
import { resolveModelMeta } from "./registry";
import type { ModelMeta } from "./types";

const log = new ScopedLogger("ModelMeta");

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

  if (!reasoning.supportsEffort) {
    deleteOutputConfigEffort(data, changes);
  }

  const thinking = data.thinking;
  if (thinking && typeof thinking === "object" && !Array.isArray(thinking)) {
    const t = thinking as Record<string, unknown>;
    const type = typeof t.type === "string" ? t.type.toLowerCase() : "";

    if (!reasoning.supportsThinking) {
      delete data.thinking;
      changes.push("thinking");
    } else if (!reasoning.supportsAdaptiveThinking && type === "adaptive") {
      delete data.thinking;
      changes.push("thinking");
    }
  } else if (!reasoning.supportsThinking && data.thinking !== undefined) {
    delete data.thinking;
    changes.push("thinking");
  }

  if (meta.anthropic?.supportsSystemRoleInMessages === false) {
    if (hoistInlineSystemMessagesToAnthropicSystem(data)) {
      changes.push("messages.system->system");
    }
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
  const meta = resolveModelMeta(model, { vendor: "anthropic" });
  sanitizeAnthropicRequestByMeta(data, meta);
}
