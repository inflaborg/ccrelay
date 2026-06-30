import type { ApiSurface } from "../../types";

/** Parsed availability probe request (max_tokens or max_completion_tokens === 1). */
export interface AvailabilityProbeDetection {
  model: string;
  stream: boolean;
  responseSurface: ApiSurface;
}
