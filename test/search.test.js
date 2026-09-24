import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFishModels, searchFishModelsByName } from '../src/search.js';

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

test('explicit voice hints affect search ranking', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ items: [
    { _id: 'male', title: 'Sample Voice', state: 'trained', tags: ['male'] },
    { _id: 'female', title: 'Sample Voice', state: 'trained', tags: ['female'] }
  ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await searchFishModelsByName('Sample Voice', {
    apiKey: 'test', baseUrl: 'https://example.invalid',
    hints: { genders: ['female'], languages: [], tags: [] }, signal: null
  });
  assert.equal(result.items[0]._id, 'female');
  assert.deepEqual(result.hints.genders, ['female']);
});
