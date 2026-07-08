/**
 * Matches backend stats aggregation (Dashboard avg TTFB / output TPS).
 * Per-log UI prefers phase timing fields when present.
 */
export const STREAM_GEN_TIME_MIN_MS = 500;

export interface StreamPerfLog {
  ttfb?: number;
  upstreamTtfbMs?: number;
  genMs?: number;
  duration: number;
  outputTokens?: number;
}

/** Effective upstream TTFB: phase field first, legacy ttfb fallback. */
export function effectiveTtfb(log: StreamPerfLog): number | undefined {
  if (log.upstreamTtfbMs != null && log.upstreamTtfbMs > 0) {
    return log.upstreamTtfbMs;
  }
  if (log.ttfb != null && log.ttfb > 0) {
    return log.ttfb;
  }
  return undefined;
}

/** Effective post-header generation time in ms. */
export function effectiveGenMs(log: StreamPerfLog): number | undefined {
  if (log.genMs != null && log.genMs > 0) {
    return log.genMs;
  }
  const ttfb = effectiveTtfb(log);
  if (ttfb != null && log.duration > ttfb) {
    return log.duration - ttfb;
  }
  return undefined;
}

/** True when the log row has stream TTFB persisted by the proxy. */
export function hasStreamTtfb(log: StreamPerfLog): boolean {
  const ttfb = effectiveTtfb(log);
  if (ttfb == null || !log.duration) {
    return false;
  }
  const gen = effectiveGenMs(log);
  return gen != null && gen > 0;
}

/** @deprecated Alias for log list/detail TTFB column. */
export function hasStreamPerfMetrics(log: StreamPerfLog): boolean {
  return hasStreamTtfb(log);
}

export function outputTps(log: StreamPerfLog): number | null {
  if (!hasStreamTtfb(log) || log.outputTokens == null) {
    return null;
  }
  const genTime = effectiveGenMs(log);
  if (genTime == null || genTime <= 0) {
    return null;
  }
  const calcTime = Math.max(genTime, 1000);
  return (log.outputTokens / calcTime) * 1000;
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s` : `${ms}ms`;
}
