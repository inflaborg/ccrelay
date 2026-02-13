import { describe, it, expect } from "vitest";
import { Semaphore } from "../../../src/queue/semaphore";

describe("Semaphore", () => {
  it("should initialize with given permits", () => {
    const semaphore = new Semaphore(3);
    expect(semaphore.available).toBe(3);
    expect(semaphore.getStats().available).toBe(3);
  });

  it("should throw error if initialized with <= 0 permits", () => {
    expect(() => new Semaphore(0)).toThrow("Semaphore permits must be greater than 0");
    expect(() => new Semaphore(-1)).toThrow("Semaphore permits must be greater than 0");
  });

  it("should acquire permit immediately if available", async () => {
    const semaphore = new Semaphore(1);
    const lease = await semaphore.acquire();
    expect(semaphore.available).toBe(0);
    expect(semaphore.getStats().leased).toBe(1);
    lease.release();
    expect(semaphore.available).toBe(1);
  });

  it("should wait if no permit available", async () => {
    const semaphore = new Semaphore(1);
    const lease1 = await semaphore.acquire();
    expect(semaphore.available).toBe(0);

    let acquired2 = false;
    const promise2 = semaphore.acquire().then(lease => {
      acquired2 = true;
      return lease;
    });

    expect(acquired2).toBe(false);
    expect(semaphore.getStats().waiting).toBe(1);

    lease1.release();
    await new Promise(resolve => setTimeout(resolve, 0)); // Let promise resolve

    expect(acquired2).toBe(true);
    const lease2 = await promise2;
    lease2.release();
  });

  it("should process requests in FIFO order", async () => {
    const semaphore = new Semaphore(1);
    const lease1 = await semaphore.acquire();

    const order: number[] = [];

    // Queue 3 requests
    const p1 = semaphore.acquire().then(l => {
      order.push(1);
      l.release();
    });
    const p2 = semaphore.acquire().then(l => {
      order.push(2);
      l.release();
    });
    const p3 = semaphore.acquire().then(l => {
      order.push(3);
      l.release();
    });

    lease1.release();

    // Wait for all to complete
    await Promise.all([p1, p2, p3]);

    expect(order).toEqual([1, 2, 3]);
  });

  it("should automatically release permit on dispose", async () => {
    const semaphore = new Semaphore(1);

    {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      using _lease = await semaphore.acquire();
      expect(semaphore.available).toBe(0);
    } // lease disposed here

    expect(semaphore.available).toBe(1);
  });
});
