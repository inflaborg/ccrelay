import { describe, it, expect, afterEach } from "vitest";
import { EventLoopMonitor } from "@/server/eventLoopMonitor";

function blockFor(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // busy-wait to stall the event loop
  }
}

function waitTurn(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe("EventLoopMonitor", () => {
  const monitor = new EventLoopMonitor();

  afterEach(() => {
    monitor.stop();
  });

  it("returns a zero snapshot before start", () => {
    expect(monitor.sample()).toMatchObject({ p99Ms: 0, maxMs: 0, peakMs: 0 });
  });

  it("captures a blocked event loop and keeps the peak across windows", async () => {
    monitor.start();
    await waitTurn(30);
    blockFor(150);
    await waitTurn(30);

    const first = monitor.sample();
    expect(first.maxMs).toBeGreaterThanOrEqual(100);
    expect(first.peakMs).toBe(first.maxMs);
    expect(monitor.snapshot()).toEqual(first);

    await waitTurn(30);
    const second = monitor.sample();
    expect(second.maxMs).toBeLessThan(first.maxMs);
    expect(second.peakMs).toBe(first.peakMs);
  });
});
