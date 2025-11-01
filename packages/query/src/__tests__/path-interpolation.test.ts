import { describe, it, expect } from 'vitest';
import { createPathInterpolator } from '../pathInterpolator.js';

describe('createPathInterpolator', () => {
  describe('basic path interpolation', () => {
    it('should interpolate a single parameter', () => {
      const interpolate = createPathInterpolator('/users/[userId]');
      const result = interpolate({ userId: '123' });
      expect(result).toBe('/users/123');
    });

    it('should interpolate multiple parameters', () => {
      const interpolate = createPathInterpolator('/users/[userId]/posts/[postId]');
      const result = interpolate({ userId: '123', postId: '456' });
      expect(result).toBe('/users/123/posts/456');
    });

    it('should handle consecutive parameters', () => {
      const interpolate = createPathInterpolator('/items/[category][subcategory]');
      const result = interpolate({ category: 'books', subcategory: 'fiction' });
      expect(result).toBe('/items/booksfiction');
    });

    it('should handle path with no parameters', () => {
      const interpolate = createPathInterpolator('/static/path');
      const result = interpolate({});
      expect(result).toBe('/static/path');
    });

    it('should handle path starting with parameter', () => {
      const interpolate = createPathInterpolator('[tenant]/users/[userId]');
      const result = interpolate({ tenant: 'acme', userId: '123' });
      expect(result).toBe('acme/users/123');
    });

    it('should handle path ending with parameter', () => {
      const interpolate = createPathInterpolator('/users/[userId]');
      const result = interpolate({ userId: '123' });
      expect(result).toBe('/users/123');
    });
  });

  describe('URL encoding', () => {
    it('should URL-encode special characters in path parameters', () => {
      const interpolate = createPathInterpolator('/users/[userId]');
      const result = interpolate({ userId: 'user@example.com' });
      expect(result).toBe('/users/user%40example.com');
    });

    it('should URL-encode spaces', () => {
      const interpolate = createPathInterpolator('/search/[query]');
      const result = interpolate({ query: 'hello world' });
      expect(result).toBe('/search/hello%20world');
    });

    it('should URL-encode forward slashes', () => {
      const interpolate = createPathInterpolator('/files/[path]');
      const result = interpolate({ path: 'folder/subfolder/file.txt' });
      expect(result).toBe('/files/folder%2Fsubfolder%2Ffile.txt');
    });

    it('should handle unicode characters', () => {
      const interpolate = createPathInterpolator('/items/[name]');
      const result = interpolate({ name: '日本語' });
      expect(result).toBe('/items/%E6%97%A5%E6%9C%AC%E8%AA%9E');
    });
  });

  describe('query string parameters', () => {
    it('should append extra parameters as query string', () => {
      const interpolate = createPathInterpolator('/users/[userId]');
      const result = interpolate({ userId: '123', page: 2, limit: 10 });
      expect(result).toBe('/users/123?page=2&limit=10');
    });

    it('should append all non-path parameters as query string', () => {
      const interpolate = createPathInterpolator('/users/[userId]/posts/[postId]');
      const result = interpolate({
        userId: '123',
        postId: '456',
        page: 2,
        limit: 10,
        sort: 'desc',
      });
      expect(result).toBe('/users/123/posts/456?page=2&limit=10&sort=desc');
    });

    it('should handle only query parameters when path has no params', () => {
      const interpolate = createPathInterpolator('/search');
      const result = interpolate({ q: 'test', page: 1 });
      expect(result).toBe('/search?q=test&page=1');
    });

    it('should skip undefined query parameters', () => {
      const interpolate = createPathInterpolator('/users/[userId]');
      const result = interpolate({ userId: '123', page: 2, limit: undefined });
      expect(result).toBe('/users/123?page=2');
    });

    it('should include null and empty string values in query params', () => {
      const interpolate = createPathInterpolator('/users/[userId]');
      const result = interpolate({ userId: '123', filter: null, name: '' });
      expect(result).toBe('/users/123?filter=null&name=');
    });

    it('should handle boolean query parameters', () => {
      const interpolate = createPathInterpolator('/items');
      const result = interpolate({ active: true, deleted: false });
      expect(result).toBe('/items?active=true&deleted=false');
    });

    it('should handle numeric query parameters', () => {
      const interpolate = createPathInterpolator('/items');
      const result = interpolate({ id: 0, count: 100 });
      expect(result).toBe('/items?id=0&count=100');
    });
  });

  describe('type coercion', () => {
    it('should convert numeric path parameters to string', () => {
      const interpolate = createPathInterpolator('/users/[userId]');
      const result = interpolate({ userId: 123 });
      expect(result).toBe('/users/123');
    });

    it('should convert boolean path parameters to string', () => {
      const interpolate = createPathInterpolator('/settings/[enabled]');
      const result = interpolate({ enabled: true });
      expect(result).toBe('/settings/true');
    });

    it('should convert null path parameters to string', () => {
      const interpolate = createPathInterpolator('/items/[id]');
      const result = interpolate({ id: null });
      expect(result).toBe('/items/null');
    });

    it('should handle object conversion to string', () => {
      const interpolate = createPathInterpolator('/items/[id]');
      const result = interpolate({ id: { value: 123 } });
      expect(result).toBe('/items/%5Bobject%20Object%5D');
    });
  });

  describe('edge cases', () => {
    it('should handle empty path template', () => {
      const interpolate = createPathInterpolator('');
      const result = interpolate({});
      expect(result).toBe('');
    });

    it('should handle empty params object', () => {
      const interpolate = createPathInterpolator('/users/[userId]/posts/[postId]');
      const result = interpolate({});
      expect(result).toBe('/users/undefined/posts/undefined');
    });

    it('should handle missing path parameter values', () => {
      const interpolate = createPathInterpolator('/users/[userId]/posts/[postId]');
      const result = interpolate({ userId: '123' });
      expect(result).toBe('/users/123/posts/undefined');
    });

    it('should handle parameter names with underscores', () => {
      const interpolate = createPathInterpolator('/users/[user_id]');
      const result = interpolate({ user_id: '123' });
      expect(result).toBe('/users/123');
    });

    it('should handle parameter names with hyphens', () => {
      const interpolate = createPathInterpolator('/users/[user-id]');
      const result = interpolate({ 'user-id': '123' });
      expect(result).toBe('/users/123');
    });

    it('should handle parameter names with numbers', () => {
      const interpolate = createPathInterpolator('/items/[item1]/[item2]');
      const result = interpolate({ item1: 'first', item2: 'second' });
      expect(result).toBe('/items/first/second');
    });

    it('should be reusable for multiple interpolations', () => {
      const interpolate = createPathInterpolator('/users/[userId]');

      const result1 = interpolate({ userId: '123' });
      const result2 = interpolate({ userId: '456' });
      const result3 = interpolate({ userId: '789', page: 1 });

      expect(result1).toBe('/users/123');
      expect(result2).toBe('/users/456');
      expect(result3).toBe('/users/789?page=1');
    });

    it('should handle complex real-world example', () => {
      const interpolate = createPathInterpolator('/api/v1/tenants/[tenantId]/users/[userId]/documents/[documentId]');
      const result = interpolate({
        tenantId: 'acme-corp',
        userId: 'user@example.com',
        documentId: '12345',
        version: 2,
        format: 'pdf',
        download: true,
      });
      expect(result).toBe(
        '/api/v1/tenants/acme-corp/users/user%40example.com/documents/12345?version=2&format=pdf&download=true',
      );
    });
  });

  describe('performance characteristics', () => {
    it('should create the interpolator once and reuse it efficiently', () => {
      const interpolate = createPathInterpolator('/users/[userId]/posts/[postId]');

      // Simulate multiple calls (as would happen in production)
      const results = [];
      for (let i = 0; i < 1000; i++) {
        results.push(interpolate({ userId: `user${i}`, postId: `post${i}` }));
      }

      expect(results[0]).toBe('/users/user0/posts/post0');
      expect(results[999]).toBe('/users/user999/posts/post999');
      expect(results.length).toBe(1000);
    });
  });
});
