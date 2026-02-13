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
   * Add an item with a priority
   * Higher priority values are processed first
   */
  enqueue(item: T, priority: number = 0): void {
    const priorityItem: PriorityItem<T> = {
      item,
      priority,
      order: this.counter++,
    };

    // Find the correct position to insert (higher priority first)
    let inserted = false;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].priority < priority) {
        this.items.splice(i, 0, priorityItem);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.items.push(priorityItem);
    }
  }

  /**
   * Remove and return the highest priority item
   */
  dequeue(): T | undefined {
    const item = this.items.shift();
    return item?.item;
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

    // Remove the item
    const [item] = this.items.splice(index, 1);

    // Re-enqueue with new priority
    item.priority = newPriority;
    let inserted = false;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].priority < newPriority) {
        this.items.splice(i, 0, item);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.items.push(item);
    }

    return true;
  }
}
