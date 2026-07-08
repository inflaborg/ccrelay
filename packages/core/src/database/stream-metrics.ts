/**
 * Stream performance metrics (TTFB, output TPS) apply only to genuine SSE streaming:
 * post-header generation time must exceed this threshold.
 */
export const STREAM_GEN_TIME_MIN_MS = 500;

/** SQL condition for metrics rows with meaningful stream perf (legacy ttfb/duration). */
export const STREAM_PERF_SQL_COND = `ttfb IS NOT NULL AND (duration - ttfb) > ${STREAM_GEN_TIME_MIN_MS}`;

/** SQL condition for output TPS using phase timings (gen_ms). */
export const STREAM_GEN_SQL_COND = `gen_ms IS NOT NULL AND gen_ms > ${STREAM_GEN_TIME_MIN_MS}`;

/** SQL condition for upstream TTFB using phase timings. */
export const UPSTREAM_TTFB_SQL_COND = `upstream_ttfb_ms IS NOT NULL AND upstream_ttfb_ms > 0`;

/** SQL condition for end-to-end latency percentiles. */
export const TOTAL_MS_SQL_COND = `total_ms IS NOT NULL AND total_ms > 0`;
