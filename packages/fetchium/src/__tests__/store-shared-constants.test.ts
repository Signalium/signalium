import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CACHE_TIME,
  DEFAULT_GC_TIME,
  DEFAULT_MAX_COUNT,
  queueKeyFor,
  valueKeyFor,
  refIdsKeyFor,
  refCountKeyFor,
  updatedAtKeyFor,
} from '../stores/shared.js';

/**
 * Tests for shared store constants and key functions.
 * Ensures the canonical versions in shared.ts produce correct outputs.
 */

describe('Shared store constants', () => {
  it('DEFAULT_MAX_COUNT should be 50', () => {
    expect(DEFAULT_MAX_COUNT).toBe(50);
  });

  it('DEFAULT_CACHE_TIME should be 24 hours in minutes', () => {
    expect(DEFAULT_CACHE_TIME).toBe(60 * 24);
  });

  it('DEFAULT_GC_TIME should be 5 minutes', () => {
    expect(DEFAULT_GC_TIME).toBe(5);
  });
});

describe('Shared store key functions', () => {
  it('queueKeyFor should produce consistent keys', () => {
    expect(queueKeyFor('GET:/users')).toBe('sq:doc:queue:GET:/users');
    expect(queueKeyFor('POST:/items')).toBe('sq:doc:queue:POST:/items');
  });

  it('valueKeyFor should produce consistent keys', () => {
    expect(valueKeyFor(123)).toBe('sq:doc:value:123');
  });

  it('refIdsKeyFor should produce consistent keys', () => {
    expect(refIdsKeyFor(456)).toBe('sq:doc:refIds:456');
  });

  it('refCountKeyFor should produce consistent keys', () => {
    expect(refCountKeyFor(789)).toBe('sq:doc:refCount:789');
  });

  it('updatedAtKeyFor should produce consistent keys', () => {
    expect(updatedAtKeyFor(101)).toBe('sq:doc:updatedAt:101');
  });
});
