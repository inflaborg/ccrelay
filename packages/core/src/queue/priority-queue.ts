/**
 * Priority queue implementation for task scheduling
 * Higher priority values are processed first
 */

interface PriorityItem<T> {
  item: T;
  priority: number;
  order: number;
}

export class PriorityQueue<T> {
  private items: PriorityItem<T>[] = [];
  private counter: number = 0;
  private comparator: (a: T, b: T) => number;

  constructor(comparator?: (a: T, b: T) => number) {
    this.comparator =
      comparator ??
      ((a: T, b: T) => {
        if (a === b) {
          return 0;
        }
        return a < b ? -1 : 1;
      });
  }

  /**
   * Compare two PriorityItems.
   * Higher priority comes first. If priorities are equal, lower order (first in) comes first.
   * Returns true if item1 should come BEFORE item2.
   */
  private compare(item1: PriorityItem<T>, item2: PriorityItem<T>): boolean {
    if (item1.priority !== item2.priority) {
      return item1.priority > item2.priority;
    }
    return item1.order < item2.order;
  }

  private siftUp(index: number): void {
    let currentIndex = index;
    const currentItem = this.items[currentIndex];

    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2);
      const parentItem = this.items[parentIndex];

      if (this.compare(currentItem, parentItem)) {
        this.items[currentIndex] = parentItem;
        currentIndex = parentIndex;
      } else {
        break;
      }
    }
    this.items[currentIndex] = currentItem;
  }

  private siftDown(index: number): void {
    let currentIndex = index;
    const currentItem = this.items[currentIndex];
    const length = this.items.length;

    while (true) {
      const leftChildIndex = 2 * currentIndex + 1;
      const rightChildIndex = 2 * currentIndex + 2;
      let targetIndex = currentIndex;

      if (
        leftChildIndex < length &&
        this.compare(this.items[leftChildIndex], this.items[targetIndex])
      ) {
        targetIndex = leftChildIndex;
      }

      if (
        rightChildIndex < length &&
        this.compare(this.items[rightChildIndex], this.items[targetIndex])
      ) {
        targetIndex = rightChildIndex;
      }

      if (targetIndex !== currentIndex) {
        this.items[currentIndex] = this.items[targetIndex];
        currentIndex = targetIndex;
      } else {
        break;
      }
    }
    this.items[currentIndex] = currentItem;
  }

  /**
   * Add an item with a priority
   * Higher priority values are processed first
   */
  enqueue(item: T, priority: number = 0): void {
    const priorityItem: PriorityItem<T> = {
      item,
      priority,
      order: this.counter++,
    };

    this.items.push(priorityItem);
    this.siftUp(this.items.length - 1);
  }

  /**
   * Remove and return the highest priority item
   */
  dequeue(): T | undefined {
    if (this.items.length === 0) {
      return undefined;
    }
    if (this.items.length === 1) {
      return this.items.pop()?.item;
    }

    const firstItem = this.items[0];
    const lastItem = this.items.pop()!;
    this.items[0] = lastItem;
    this.siftDown(0);

    return firstItem.item;
  }

  /**
   * Return the highest priority item without removing it
   */
  peek(): T | undefined {
    return this.items[0]?.item;
  }

  /**
   * Get the number of items in the queue
   */
  size(): number {
    return this.items.length;
  }

  /**
   * Check if the queue is empty
   */
  isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Clear all items from the queue
   */
  clear(): void {
    this.items = [];
    this.counter = 0;
  }

  /**
   * Get all items without removing them
   * Warning: The returned array is not sorted by priority in a heap
   */
  toArray(): T[] {
    return this.items.map(p => p.item);
  }

  /**
   * Update priority of an item (requires a predicate to find it)
   * Returns true if the item was found and updated
   */
  updatePriority(predicate: (item: T) => boolean, newPriority: number): boolean {
    const index = this.items.findIndex(p => predicate(p.item));
    if (index === -1) {
      return false;
    }

    const currentPriority = this.items[index].priority;
    this.items[index].priority = newPriority;

    if (newPriority > currentPriority) {
      this.siftUp(index);
    } else if (newPriority < currentPriority) {
      this.siftDown(index);
    }
    return true;
  }

  /**
   * Remove and return an item matching the predicate
   * Returns the removed item, or undefined if not found
   */
  remove(predicate: (item: T) => boolean): T | undefined {
    const index = this.items.findIndex(p => predicate(p.item));
    if (index === -1) {
      return undefined;
    }

    const removedItem = this.items[index];
    const lastItem = this.items.pop()!;

    if (index < this.items.length) {
      this.items[index] = lastItem;
      // It might need to go up or down. To be safe, try both.
      this.siftUp(index);
      this.siftDown(index);
    }

    return removedItem.item;
  }
}
