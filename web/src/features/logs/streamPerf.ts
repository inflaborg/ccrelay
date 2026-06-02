/**
 * Matches backend stats aggregation (Dashboard avg TTFB / output TPS).
 * Per-log UI trusts backend `ttfb` (only written for incremental SSE) instead.
 */
export const STREAM_GEN_TIME_MIN_MS = 500;

/** True when the log row has stream TTFB persisted by the proxy. */
export function hasStreamTtfb(log: { ttfb?: number; duration: number }): boolean {
  if (log.ttfb == null || log.ttfb <= 0 || !log.duration) {
    return false;
  }
  // Require a post-header generation window (filters legacy rows where duration ≈ ttfb).
  return log.duration > log.ttfb;
}

/** @deprecated Alias for log list/detail TTFB column. */
export function hasStreamPerfMetrics(log: { ttfb?: number; duration: number }): boolean {
  return hasStreamTtfb(log);
}

export function outputTps(log: {
  ttfb?: number;
  duration: number;
  outputTokens?: number;
}): number | null {
  if (!hasStreamTtfb(log) || log.outputTokens == null) {
    return null;
  }
  const genTime = log.duration - log.ttfb!;
  const calcTime = Math.max(genTime, 1000);
  return (log.outputTokens / calcTime) * 1000;
}
