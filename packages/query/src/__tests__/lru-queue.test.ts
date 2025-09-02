import { LRUQueue } from '../lruQueue.js';
import { describe, it, expect } from 'vitest';

// Test helper functions
function getActiveCount(queue: LRUQueue): number {
  return queue['activeCount'];
}

function getActiveItems(queue: LRUQueue): number[] {
  const activeCount = getActiveCount(queue);
  return Array.from(queue.queue.slice(0, activeCount)).filter(x => x !== 0) as number[];
}

function getInactiveItems(queue: LRUQueue): number[] {
  const activeCount = getActiveCount(queue);
  return Array.from(queue.queue.slice(activeCount)).filter(x => x !== 0) as number[];
}

function expectQueueState(queue: LRUQueue, expected: { active: number[]; inactive?: number[] }): void {
  expect(getActiveItems(queue)).toEqual(expected.active);
  if (expected.inactive !== undefined) {
    expect(getInactiveItems(queue)).toEqual(expected.inactive);
  }
}

describe('LRUQueue', () => {
  describe('activate', () => {
    it('should add a new item to an empty queue', () => {
      const queue = new LRUQueue(5);
      const result = queue.activate(100);

      expect(result).toBe(null);
      expectQueueState(queue, { active: [100], inactive: [] });
    });

    it('should add multiple items to the front', () => {
      const queue = new LRUQueue(5);
      queue.activate(100);
      queue.activate(200);
      queue.activate(300);

      expectQueueState(queue, { active: [300, 200, 100] });
    });

    it('should move an active item to the front if not already there', () => {
      const queue = new LRUQueue(5);
      queue.activate(100);
      queue.activate(200);
      queue.activate(300);

      const result = queue.activate(100); // Move to front

      expect(result).toBe(null);
      expectQueueState(queue, { active: [100, 300, 200] });
    });

    it('should do nothing if item is already at the front', () => {
      const queue = new LRUQueue(5);
      queue.activate(100);
      queue.activate(200);

      const result = queue.activate(200); // Already at front

      expect(result).toBe(null);
      expectQueueState(queue, { active: [200, 100] });
    });

    it('should move an inactive item to front of active segment', () => {
      const queue = new LRUQueue(5);
      queue.activate(100);
      queue.activate(200);
      queue.deactivate(100); // Now inactive

      const result = queue.activate(100); // Reactivate

      expect(result).toBe(null);
      expectQueueState(queue, { active: [100, 200], inactive: [] });
    });

    it('should evict the least recently used inactive item when full', () => {
      const queue = new LRUQueue(5);
      queue.activate(100);
      queue.activate(200);
      queue.activate(300);
      queue.deactivate(100);
      queue.deactivate(200);
      queue.activate(400);
      queue.activate(500);

      // Queue: [500, 400, 300, 200, 100] - all 5 slots full
      // Active: 500, 400, 300 | Inactive: 200, 100

      const result = queue.activate(600);

      expect(result).toBe(100); // LRU inactive item
      expectQueueState(queue, {
        active: [600, 500, 400, 300],
        inactive: [200],
      });
    });

    it('should grow the queue when all items are active and capacity is reached', () => {
      const queue = new LRUQueue(3);
      queue.activate(100);
      queue.activate(200);
      queue.activate(300);

      // All active, queue is full
      const result = queue.activate(400);

      expect(result).toBe(null);
      expect(queue.queue.length).toBeGreaterThan(3);
      expectQueueState(queue, { active: [400, 300, 200, 100] });
    });

    it('should handle complex scenario with multiple activations and deactivations', () => {
      const queue = new LRUQueue(7);

      // Add some items
      queue.activate(1);
      queue.activate(2);
      queue.activate(3);
      queue.activate(4);

      // Deactivate some
      queue.deactivate(1);
      queue.deactivate(2);

      // Active: [4, 3], Inactive: [2, 1]
      expectQueueState(queue, { active: [4, 3], inactive: [2, 1] });

      // Add more
      queue.activate(5);
      queue.activate(6);
      queue.activate(7);

      // Active: [7, 6, 5, 4, 3], Inactive: [2, 1]
      expectQueueState(queue, { active: [7, 6, 5, 4, 3], inactive: [2, 1] });

      // Reactivate an inactive item
      queue.activate(1);

      // Active: [1, 7, 6, 5, 4, 3], Inactive: [2]
      expectQueueState(queue, { active: [1, 7, 6, 5, 4, 3], inactive: [2] });

      // Fill to capacity
      queue.activate(8);

      // Should evict 2 (last inactive)
      expectQueueState(queue, { active: [8, 1, 7, 6, 5, 4, 3], inactive: [] });
    });
  });

  describe('deactivate', () => {
    it('should move an active item to the inactive segment', () => {
      const queue = new LRUQueue(5);
      queue.activate(100);
      queue.activate(200);
      queue.activate(300);

      const result = queue.deactivate(200);

      expect(result).toBe(true);
      expectQueueState(queue, { active: [300, 100], inactive: [200] });
    });

    it('should return false if item is not in queue', () => {
      const queue = new LRUQueue(5);
      queue.activate(100);

      const result = queue.deactivate(999);

      expect(result).toBe(false);
      expectQueueState(queue, { active: [100] });
    });

    it('should return false if item is already inactive', () => {
      const queue = new LRUQueue(5);
      queue.activate(100);
      queue.activate(200);
      queue.deactivate(100);

      const result = queue.deactivate(100); // Already inactive

      expect(result).toBe(false);
      expectQueueState(queue, { active: [200], inactive: [100] });
    });

    it('should handle deactivating the first item', () => {
      const queue = new LRUQueue(5);
      queue.activate(100);
      queue.activate(200);
      queue.activate(300);

      queue.deactivate(300); // First item

      expectQueueState(queue, { active: [200, 100], inactive: [300] });
    });

    it('should handle deactivating the last active item', () => {
      const queue = new LRUQueue(5);
      queue.activate(100);
      queue.activate(200);
      queue.activate(300);

      queue.deactivate(100); // Last active item

      expectQueueState(queue, { active: [300, 200], inactive: [100] });
    });
  });

  describe('persistence and restart simulation', () => {
    it('should preserve queue data when reloading', () => {
      // Simulate app session 1
      const queue1 = new LRUQueue(5);
      queue1.activate(100);
      queue1.activate(200);
      queue1.activate(300);
      queue1.deactivate(100);

      // Active: [300, 200], Inactive: [100]
      const savedQueue = queue1.queue;

      // Simulate app restart - load from disk
      const queue2 = new LRUQueue(5, savedQueue);

      // After restart, activeCount is 0, so all items are inactive
      expect(getActiveCount(queue2)).toBe(0);
      expectQueueState(queue2, { active: [], inactive: [300, 200, 100] });

      // Reactivate items
      queue2.activate(300);
      expectQueueState(queue2, { active: [300], inactive: [200, 100] });
    });
  });

  describe('edge cases', () => {
    it('should handle capacity of 1', () => {
      const queue = new LRUQueue(1);
      queue.activate(100);

      expectQueueState(queue, { active: [100] });

      const result = queue.activate(200);

      // All active, should grow
      expect(result).toBe(null);
      expect(queue.queue.length).toBeGreaterThan(1);
      expectQueueState(queue, { active: [200, 100] });
    });

    it('should handle activating the same key multiple times', () => {
      const queue = new LRUQueue(5);
      queue.activate(100);
      queue.activate(100);
      queue.activate(100);

      expectQueueState(queue, { active: [100] });
      expect(getActiveCount(queue)).toBe(1);
    });

    it('should handle zero values correctly', () => {
      const queue = new LRUQueue(5);
      queue.activate(100);
      queue.activate(200);

      // Internally there are zeros, make sure they don't appear in results
      const allActive = getActiveItems(queue);
      expect(allActive).toEqual([200, 100]); // 200 is most recent
      expect(allActive.includes(0)).toBe(false);
    });
  });
});
