/**
 * Stream performance metrics (TTFB, output TPS) apply only to genuine SSE streaming:
 * post-header generation time must exceed this threshold.
 */
export const STREAM_GEN_TIME_MIN_MS = 500;

/** SQL condition for metrics rows with meaningful stream perf (SQLite/Postgres). */
export const STREAM_PERF_SQL_COND = `ttfb IS NOT NULL AND (duration - ttfb) > ${STREAM_GEN_TIME_MIN_MS}`;
