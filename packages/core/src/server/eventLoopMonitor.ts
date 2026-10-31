/**
 * Event-loop delay sampling. A blocked main thread looks like a "soft zombie" from the outside
 * (port open, HTTP silent), so the lag is logged when it spikes and exposed on status APIs.
 */

import { monitorEventLoopDelay, type IntervalHistogram } from "perf_hooks";
import { ScopedLogger } from "../utils/logger";
import type { EventLoopLagSnapshot } from "../types";

const SAMPLE_INTERVAL_MS = 10_000;
/** Warn when the p99 delay of a sample window exceeds this. */
export const EVENT_LOOP_LAG_WARN_MS = 1_000;

const nsToMs = (ns: number) => Math.round(ns / 1e6);

export class EventLoopMonitor {
  private readonly log = new ScopedLogger("EventLoop");
  private histogram: IntervalHistogram | null = null;
  private timer: NodeJS.Timeout | null = null;
  private last: EventLoopLagSnapshot = { p99Ms: 0, maxMs: 0, peakMs: 0, sampledAt: 0 };

  start(): void {
    if (this.histogram) {
      return;
    }
    this.histogram = monitorEventLoopDelay({ resolution: 20 });
    this.histogram.enable();
    this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.histogram?.disable();
    this.histogram = null;
  }

  /** Close the current window; exposed for tests. */
  sample(): EventLoopLagSnapshot {
    const h = this.histogram;
    if (!h) {
      return this.last;
    }
    const p99Ms = nsToMs(h.percentile(99));
    const maxMs = nsToMs(h.max);
    h.reset();
    this.last = {
      p99Ms,
      maxMs,
      peakMs: Math.max(this.last.peakMs, maxMs),
      sampledAt: Date.now(),
    };
    if (p99Ms > EVENT_LOOP_LAG_WARN_MS) {
      this.log.warn(
        `Event loop lag p99=${p99Ms}ms max=${maxMs}ms over the last ${SAMPLE_INTERVAL_MS / 1000}s; ` +
          `HTTP responses (including health probes) are delayed`
      );
    }
    return this.last;
  }

  snapshot(): EventLoopLagSnapshot {
    return this.last;
  }
}

export const eventLoopMonitor = new EventLoopMonitor();
