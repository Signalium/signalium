---
"@signalium/query": minor
---

Add request body support to query() function

Queries can now send JSON request bodies for POST requests, enabling read-like operations that require complex data structures (e.g., fetching prices for an array of tokens).

**New features:**
- Added `body` field to query definitions for specifying request body schema
- Body parameters are automatically serialized as JSON with `Content-Type: application/json` header
- Body params work alongside path params and search params
- All query features (caching, staleTime, deduplication) work with body queries

**API changes:**
- Query methods are now restricted to `GET` and `POST` only (PUT, PATCH, DELETE should use `mutation()`)

**Example:**
```typescript
const getPrices = query(() => ({
  path: '/prices',
  method: 'POST',
  body: {
    tokens: t.array(t.string),
  },
  searchParams: {
    currency: t.string,
  },
  response: {
    prices: t.array(t.object({ token: t.string, price: t.number })),
  },
  cache: { staleTime: 30_000 },
}));

// Usage: POST /prices?currency=USD with body: {"tokens":["ETH","BTC"]}
const result = getPrices({ tokens: ['ETH', 'BTC'], currency: 'USD' });
```
