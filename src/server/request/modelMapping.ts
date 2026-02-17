/**
 * Model mapping module for provider request transformation
 * Supports wildcard patterns and VL (vision-language) model maps
 */

import type { Provider, ModelMapEntry } from "../../types";
import { ScopedLogger } from "../../utils/logger";

const log = new ScopedLogger("ModelMapping");

/**
 * Model mapping result
 */
interface ModelMatchResult {
  targetModel: string;
  pattern: string;
}

/**
 * Detect if request body contains image content
 * Follows Anthropic API standard for message content
 */
export function containsImageContent(data: unknown): boolean {
  if (!data || typeof data !== "object") {
    return false;
  }

  const body = data as Record<string, unknown>;

  // Check for messages array (Anthropic Messages API)
  if (body.messages && Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (message && typeof message === "object") {
        const msg = message as Record<string, unknown>;
        if (msg.content && Array.isArray(msg.content)) {
          for (const item of msg.content) {
            if (item && typeof item === "object") {
              const contentItem = item as Record<string, unknown>;
              // Check for image type (Anthropic format)
              if (contentItem.type === "image") {
                return true;
              }
              // Also check for OpenAI-compatible format (image_url)
              if (contentItem.type === "image_url") {
                return true;
              }
              // Check nested image_url object
              if (contentItem.image_url && typeof contentItem.image_url === "object") {
                return true;
              }
            }
          }
        }
      }
    }
  }

  return false;
}

/**
 * Match a model against a model map (supports exact match and wildcards)
 * Model map is now an array of { pattern, model } entries
 */
export function matchModel(
  model: string,
  modelMap: ModelMapEntry[]
): ModelMatchResult | null {
  for (const entry of modelMap) {
    const { pattern, model: targetModel } = entry;

    // Check for exact match first
    if (pattern === model) {
      return { targetModel, pattern };
    }

    // Check for wildcard patterns
    if (pattern.includes("*")) {
      // Convert wildcard pattern to regex
      const patternRegex = new RegExp(
        "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
      );
      if (patternRegex.test(model)) {
        return { targetModel, pattern };
      }
    }
  }

  return null;
}

/**
 * Apply model mapping based on provider's modelMap configuration
 * Supports wildcard patterns (e.g., "claude-*" matches "claude-opus-4-5")
 *
 * Priority:
 * 1. If request contains images and vlModelMap exists -> use vlModelMap
 * 2. Otherwise, use modelMap
 * 3. If no match in selected map, fall back to the other map
 */
export function applyModelMapping(body: Buffer, provider: Provider): Buffer {
  if (!body) {
    return body;
  }

  const hasVlMap = provider.vlModelMap && provider.vlModelMap.length > 0;
  const hasRegularMap = provider.modelMap && provider.modelMap.length > 0;

  if (!hasVlMap && !hasRegularMap) {
    return body;
  }

  try {
    const bodyStr = body.toString("utf-8");
    const data = JSON.parse(bodyStr) as Record<string, unknown>;

    if (data.model) {
      const originalModel = data.model as string;
      const hasImages = containsImageContent(data);

      // Determine which map to use first
      const firstMap = hasImages && hasVlMap ? provider.vlModelMap : provider.modelMap;
      const secondMap =
        firstMap === provider.modelMap && hasVlMap
          ? provider.vlModelMap
          : hasRegularMap
            ? provider.modelMap
            : null;

      // Determine mapping type for logging
      const isVlMapping = firstMap === provider.vlModelMap;
      const mappingType = isVlMapping ? "VL" : "Regular";

      // Try first map
      let result: ModelMatchResult | null = null;
      if (firstMap) {
        result = matchModel(originalModel, firstMap);
      }

      // Fall back to second map if no match
      if (!result && secondMap) {
        result = matchModel(originalModel, secondMap);
      }

      // Apply mapping if found
      if (result) {
        data.model = result.targetModel;
        log.info(
          `[ModelMapping:${mappingType}] "${originalModel}" -> "${result.targetModel}" (pattern: ${result.pattern})`
        );
        return Buffer.from(JSON.stringify(data));
      }
    }

    return body;
  } catch (err) {
    log.error("[ModelMapping] Failed to parse body", err);
    return body;
  }
}
