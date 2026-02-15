/**
 * Body Processor Stage - handles request body transformation
 */

import type { RoutingContext, BodyProcessResult } from "./context";
import { applyModelMapping } from "../proxy/modelMapping";
import { convertRequestToOpenAI } from "../../converter";
import { ScopedLogger } from "../../utils/logger";

const log = new ScopedLogger("BodyProcessor");

/**
 * BodyProcessor handles model mapping and OpenAI format conversion
 */
export class BodyProcessor {
  /**
   * Process request body - applies model mapping and OpenAI conversion
   */
  process(
    rawBody: Buffer,
    routing: RoutingContext,
    databaseEnabled: boolean
  ): BodyProcessResult {
    let originalModel: string | undefined;
    let originalRequestBody: string | undefined;
    let requestBodyLog: string | undefined;

    // Save original body for logging
    if (databaseEnabled && rawBody.length > 0) {
      try {
        originalRequestBody = rawBody.toString("utf-8");
      } catch {
        originalRequestBody = undefined;
      }
    }

    // Apply model mapping (e.g., claude-* -> glm-4.7)
    let body = applyModelMapping(rawBody, routing.provider);

    // Convert for OpenAI provider
    if (routing.isOpenAIProvider && body && body.length > 0) {
      const conversionResult = this.convertForOpenAI(body, routing.targetPath);
      if (conversionResult) {
        body = conversionResult.body;
        originalModel = conversionResult.originalModel;
        routing.targetPath = conversionResult.newPath;

        // Update target URL with new path
        const baseUrl = routing.provider.baseUrl.replace(/\/$/, "");
        routing.targetUrl = `${baseUrl}${conversionResult.newPath}`;

        log.info(
          `[OpenAI] URL conversion: ${routing.targetPath} -> ${conversionResult.newPath}, final="${routing.targetUrl}"`
        );
      }
    }

    // Capture request body for logging
    if (databaseEnabled && body && body.length > 0) {
      try {
        requestBodyLog = body.toString("utf-8");
      } catch {
        requestBodyLog = undefined;
      }
    }

    return {
      body,
      originalModel,
      originalRequestBody,
      requestBodyLog,
    };
  }

  /**
   * Convert request for OpenAI provider
   */
  private convertForOpenAI(
    body: Buffer,
    path: string
  ): { body: Buffer; newPath: string; originalModel: string | undefined } | null {
    try {
      const bodyStr = body.toString("utf-8");
      const anthropicRequest = JSON.parse(bodyStr) as Record<string, unknown>;

      // Check if this looks like an Anthropic Messages API request
      if (!anthropicRequest.messages || !Array.isArray(anthropicRequest.messages)) {
        return null;
      }

      const conversionResult = convertRequestToOpenAI(
        anthropicRequest as unknown as Parameters<typeof convertRequestToOpenAI>[0],
        path
      );

      // Extract original model from the original body
      let originalModel: string | undefined;
      try {
        const originalData = JSON.parse(bodyStr) as Record<string, unknown>;
        originalModel = originalData.model as string | undefined;
      } catch {
        // ignore
      }

      return {
        body: Buffer.from(JSON.stringify(conversionResult.request), "utf-8"),
        newPath: conversionResult.newPath,
        originalModel,
      };
    } catch (err) {
      log.error("[OpenAI Conversion] Failed to convert request", err);
      return null;
    }
  }
}
