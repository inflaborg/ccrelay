/**
 * Log snapshot for locally handled service interceptors.
 * Model mapping is recorded so the log shows which configured target was hit.
 * The interceptor itself still runs on the original client body.
 */

import type { Provider } from "../../types";
import type { BodyProcessResult } from "./context";
import { applyModelMapping } from "./modelMapping";

export function buildServiceRequestLogSnapshot(
  rawBody: Buffer,
  provider: Provider,
  databaseEnabled: boolean
): Pick<BodyProcessResult, "originalRequestBody" | "requestBodyLog"> {
  if (!databaseEnabled || rawBody.length === 0) {
    return { originalRequestBody: undefined, requestBodyLog: undefined };
  }

  let original: string;
  try {
    original = rawBody.toString("utf-8");
  } catch {
    return { originalRequestBody: undefined, requestBodyLog: undefined };
  }

  const mapped = applyModelMapping(rawBody, provider);
  if (mapped === rawBody) {
    return { originalRequestBody: original, requestBodyLog: original };
  }

  try {
    return { originalRequestBody: original, requestBodyLog: mapped.toString("utf-8") };
  } catch {
    return { originalRequestBody: original, requestBodyLog: original };
  }
}
