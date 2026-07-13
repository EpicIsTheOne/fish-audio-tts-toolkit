import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFishModels } from '../src/search.js';

test('model cache is bounded and behaves as an LRU cache', async (t) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({ total: 0, items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const cache = new Map();
  const options = { apiKey: 'test', baseUrl: 'https://example.invalid', cache, maxCacheEntries: 2, signal: null };
  await fetchFishModels({ ...options, params: { title: 'one' } });
  await fetchFishModels({ ...options, params: { title: 'two' } });
  await fetchFishModels({ ...options, params: { title: 'one' } });
  await fetchFishModels({ ...options, params: { title: 'three' } });

  assert.equal(requests, 3);
  assert.equal(cache.size, 2);
  assert.equal(cache.has('title=one'), true);
  assert.equal(cache.has('title=two'), false);
});
