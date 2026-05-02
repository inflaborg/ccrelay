/**
 * Semaphore for controlling concurrent access to a resource
 * Uses async/await pattern for acquiring and releasing permits
 */

import type { SemaphoreLease } from "../types";

export class Semaphore {
  private permits: number;
  private waitQueue: Array<(lease: SemaphoreLease) => void> = [];
  private leasedPermits: number = 0;

  constructor(permits: number) {
    if (permits <= 0) {
      throw new Error("Semaphore permits must be greater than 0");
    }
    this.permits = permits;
  }

  /**
   * Get the number of available permits
   */
  get available(): number {
    return Math.max(0, this.permits - this.leasedPermits);
  }

  /**
   * Acquire a permit, returning a Promise that resolves when a permit is available
   */
  async acquire(): Promise<SemaphoreLease> {
    return new Promise<SemaphoreLease>(resolve => {
      if (this.available > 0) {
        this.leasedPermits++;
        resolve(new SemaphoreLeaseImpl(this));
      } else {
        // Add to wait queue
        this.waitQueue.push(lease => resolve(lease));
      }
    });
  }

  /**
   * Release a permit back to the semaphore
   * This is called internally by SemaphoreLease
   */
  release(): void {
    this.leasedPermits--;

    // If there are tasks waiting, assign the permit to the next one
    const nextCallback = this.waitQueue.shift();
    if (nextCallback) {
      this.leasedPermits++;
      nextCallback(new SemaphoreLeaseImpl(this));
    }
  }

  /**
   * Get current statistics
   */
  getStats(): { available: number; leased: number; waiting: number } {
    return {
      available: this.available,
      leased: this.leasedPermits,
      waiting: this.waitQueue.length,
    };
  }

  /**
   * Update the number of permits
   * Releases waiting tasks if permits are increased
   */
  updatePermits(newPermits: number): void {
    if (newPermits <= 0) {
      throw new Error("Semaphore permits must be greater than 0");
    }

    const diff = newPermits - this.permits;
    this.permits = newPermits;

    if (diff > 0) {
      // If we increased permits, we might be able to release some waiting tasks
      while (this.available > 0 && this.waitQueue.length > 0) {
        const nextCallback = this.waitQueue.shift();
        if (nextCallback) {
          this.leasedPermits++;
          nextCallback(new SemaphoreLeaseImpl(this));
        }
      }
    }
  }
}

/**
 * Semaphore lease that automatically releases when disposed
 */
class SemaphoreLeaseImpl implements SemaphoreLease {
  private released: boolean = false;

  constructor(private semaphore: Semaphore) {}

  release(): void {
    if (!this.released) {
      this.released = true;
      this.semaphore.release();
    }
  }

  [Symbol.dispose](): void {
    this.release();
  }
}
