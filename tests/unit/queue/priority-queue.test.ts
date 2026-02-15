import { describe, it, expect } from "vitest";
import { PriorityQueue } from "../../../src/queue/priority-queue";

describe("PriorityQueue", () => {
  it("should start empty", () => {
    const queue = new PriorityQueue<string>();
    expect(queue.size()).toBe(0);
    expect(queue.isEmpty()).toBe(true);
    expect(queue.dequeue()).toBeUndefined();
  });

  it("should enqueue items and increase size", () => {
    const queue = new PriorityQueue<string>();
    queue.enqueue("item1", 1);
    expect(queue.size()).toBe(1);
    expect(queue.isEmpty()).toBe(false);
    queue.enqueue("item2", 2);
    expect(queue.size()).toBe(2);
  });

  it("should dequeue highest priority items first", () => {
    const queue = new PriorityQueue<string>();
    queue.enqueue("low", 1);
    queue.enqueue("high", 10);
    queue.enqueue("medium", 5);

    expect(queue.dequeue()).toBe("high");
    expect(queue.dequeue()).toBe("medium");
    expect(queue.dequeue()).toBe("low");
  });

  it("should maintain FIFO order for same priority", () => {
    const queue = new PriorityQueue<string>();
    queue.enqueue("first", 1);
    queue.enqueue("second", 1);
    queue.enqueue("third", 1);

    expect(queue.dequeue()).toBe("first");
    expect(queue.dequeue()).toBe("second");
    expect(queue.dequeue()).toBe("third");
  });

  it("should clear the queue", () => {
    const queue = new PriorityQueue<string>();
    queue.enqueue("item1", 1);
    queue.enqueue("item2", 1);
    expect(queue.size()).toBe(2);

    queue.clear();
    expect(queue.size()).toBe(0);
    expect(queue.isEmpty()).toBe(true);
    expect(queue.dequeue()).toBeUndefined();
  });

  describe("PQ007-PQ008: updatePriority", () => {
    it("PQ007: should return false when item not found", () => {
      const queue = new PriorityQueue<string>();
      queue.enqueue("item1", 1);
      queue.enqueue("item2", 2);

      const result = queue.updatePriority(item => item === "notfound", 100);
      expect(result).toBe(false);
      expect(queue.size()).toBe(2);
    });

    it("PQ008: should update priority of existing item", () => {
      const queue = new PriorityQueue<string>();
      queue.enqueue("item1", 1);
      queue.enqueue("item2", 2);
      queue.enqueue("item3", 3);

      expect(queue.size()).toBe(3);

      // Update item2 to priority 10
      const result = queue.updatePriority(item => item === "item2", 10);
      expect(result).toBe(true);

      // Verify item2 is now at front (highest priority)
      const dequeued = queue.dequeue();
      expect(dequeued).toBe("item2");

      // Remaining items should be item3 (priority 3) then item1 (priority 1)
      expect(queue.dequeue()).toBe("item3");
      expect(queue.dequeue()).toBe("item1");
      expect(queue.size()).toBe(0);
    });
  });

  describe("PQ009-PQ010: remove", () => {
    it("PQ009: should return undefined when removing from empty queue", () => {
      const queue = new PriorityQueue<string>();
      const result = queue.remove(item => item === "anything");
      expect(result).toBeUndefined();
    });

    it("PQ009: should return undefined when item not found", () => {
      const queue = new PriorityQueue<string>();
      queue.enqueue("item1", 1);
      queue.enqueue("item2", 2);

      const result = queue.remove(item => item === "notfound");
      expect(result).toBeUndefined();
      expect(queue.size()).toBe(2);
    });

    it("PQ010: should remove and return matching item", () => {
      const queue = new PriorityQueue<string>();
      queue.enqueue("item1", 1);
      queue.enqueue("item2", 2);
      queue.enqueue("item3", 3);

      const result = queue.remove(item => item === "item2");
      expect(result).toBe("item2");
      expect(queue.size()).toBe(2);

      // Remaining items should be item3 (highest) then item1
      expect(queue.dequeue()).toBe("item3");
      expect(queue.dequeue()).toBe("item1");
    });

    it("PQ010: should maintain priority order after removal", () => {
      const queue = new PriorityQueue<string>();
      queue.enqueue("low", 1);
      queue.enqueue("medium", 5);
      queue.enqueue("high", 10);

      // Remove medium
      queue.remove(item => item === "medium");

      // Remaining should be high then low
      expect(queue.dequeue()).toBe("high");
      expect(queue.dequeue()).toBe("low");
    });
  });
});
