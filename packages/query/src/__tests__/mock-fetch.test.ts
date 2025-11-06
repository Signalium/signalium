import { describe, it, expect } from 'vitest';
import { createMockFetch } from './utils.js';

describe('createMockFetch', () => {
  it('should handle GET requests', async () => {
    const mockFetch = createMockFetch();
    mockFetch.get('/users/123', { id: 123, name: 'Alice' });

    const response = await mockFetch('/users/123', { method: 'GET' });
    const data = await response.json();

    expect(data).toEqual({ id: 123, name: 'Alice' });
    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
  });

  it('should handle POST requests with custom status', async () => {
    const mockFetch = createMockFetch();
    mockFetch.post('/users', { id: 456, name: 'Bob' }, { status: 201 });

    const response = await mockFetch('/users', { method: 'POST' });
    const data = await response.json();

    expect(data).toEqual({ id: 456, name: 'Bob' });
    expect(response.status).toBe(201);
  });

  it('should handle PUT requests', async () => {
    const mockFetch = createMockFetch();
    mockFetch.put('/users/123', { id: 123, name: 'Updated Alice' });

    const response = await mockFetch('/users/123', { method: 'PUT' });
    const data = await response.json();

    expect(data).toEqual({ id: 123, name: 'Updated Alice' });
  });

  it('should handle DELETE requests', async () => {
    const mockFetch = createMockFetch();
    mockFetch.delete('/users/123', { success: true });

    const response = await mockFetch('/users/123', { method: 'DELETE' });
    const data = await response.json();

    expect(data).toEqual({ success: true });
  });

  it('should handle PATCH requests', async () => {
    const mockFetch = createMockFetch();
    mockFetch.patch('/users/123', { id: 123, email: 'new@example.com' });

    const response = await mockFetch('/users/123', { method: 'PATCH' });
    const data = await response.json();

    expect(data).toEqual({ id: 123, email: 'new@example.com' });
  });

  it('should support custom headers', async () => {
    const mockFetch = createMockFetch();
    mockFetch.get(
      '/users/123',
      { id: 123 },
      {
        headers: { 'X-Custom-Header': 'test-value' },
      },
    );

    const response = await mockFetch('/users/123', { method: 'GET' });

    expect(response.headers.get('X-Custom-Header')).toBe('test-value');
  });

  it('should support delays', async () => {
    const mockFetch = createMockFetch();
    mockFetch.get('/users/123', { id: 123 }, { delay: 100 });

    const start = Date.now();
    await mockFetch('/users/123', { method: 'GET' });
    const duration = Date.now() - start;

    expect(duration).toBeGreaterThanOrEqual(90); // Allow some margin
  });

  it('should match path parameters', async () => {
    const mockFetch = createMockFetch();
    mockFetch.get('/users/[id]', { id: 123, name: 'Alice' });

    const response = await mockFetch('/users/123', { method: 'GET' });
    const data = await response.json();

    expect(data).toEqual({ id: 123, name: 'Alice' });
  });

  it('should match multiple path parameters', async () => {
    const mockFetch = createMockFetch();
    mockFetch.get('/users/[userId]/posts/[postId]', { userId: 5, postId: 10 });

    const response = await mockFetch('/users/5/posts/10', { method: 'GET' });
    const data = await response.json();

    expect(data).toEqual({ userId: 5, postId: 10 });
  });

  it('should throw error for unmocked routes', async () => {
    const mockFetch = createMockFetch();

    await expect(mockFetch('/users/123', { method: 'GET' })).rejects.toThrow(
      'No mock response configured for GET /users/123',
    );
  });

  it('should track all calls', async () => {
    const mockFetch = createMockFetch();
    mockFetch.get('/users/123', { id: 123 });
    mockFetch.post('/users', { id: 456 });

    await mockFetch('/users/123', { method: 'GET' });
    await mockFetch('/users', { method: 'POST', body: '{}' });

    expect(mockFetch.calls).toHaveLength(2);
    expect(mockFetch.calls[0].url).toBe('/users/123');
    expect(mockFetch.calls[1].url).toBe('/users');
  });

  it('should reset routes and calls', async () => {
    const mockFetch = createMockFetch();
    mockFetch.get('/users/123', { id: 123 });

    await mockFetch('/users/123', { method: 'GET' });
    expect(mockFetch.calls).toHaveLength(1);

    mockFetch.reset();

    expect(mockFetch.calls).toHaveLength(0);
    await expect(mockFetch('/users/123', { method: 'GET' })).rejects.toThrow('No mock response configured');
  });

  it('should default to GET method', async () => {
    const mockFetch = createMockFetch();
    mockFetch.get('/users/123', { id: 123 });

    const response = await mockFetch('/users/123');
    const data = await response.json();

    expect(data).toEqual({ id: 123 });
  });

  it('should handle query parameters in URLs', async () => {
    const mockFetch = createMockFetch();
    mockFetch.get('/users', { users: [] });

    const response = await mockFetch('/users?page=1&limit=10', { method: 'GET' });
    const data = await response.json();

    expect(data).toEqual({ users: [] });
  });

  it('should reuse the last match when no unused mocks remain', async () => {
    const mockFetch = createMockFetch();
    mockFetch.get('/users/123', { id: 123, name: 'Alice' });

    // First call should succeed
    const response1 = await mockFetch('/users/123', { method: 'GET' });
    const data1 = await response1.json();
    expect(data1).toEqual({ id: 123, name: 'Alice' });

    // Second call should reuse the same mock since there are no unused ones
    const response2 = await mockFetch('/users/123', { method: 'GET' });
    const data2 = await response2.json();
    expect(data2).toEqual({ id: 123, name: 'Alice' });
  });

  it('should allow multiple setups for repeated calls', async () => {
    const mockFetch = createMockFetch();
    mockFetch.get('/users/123', { id: 123, name: 'Alice' });
    mockFetch.get('/users/123', { id: 123, name: 'Updated Alice' });

    const response1 = await mockFetch('/users/123', { method: 'GET' });
    const data1 = await response1.json();
    expect(data1).toEqual({ id: 123, name: 'Alice' });

    const response2 = await mockFetch('/users/123', { method: 'GET' });
    const data2 = await response2.json();
    expect(data2).toEqual({ id: 123, name: 'Updated Alice' });
  });
});
