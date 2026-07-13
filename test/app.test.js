import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createApp, isLoopbackHost, startServer } from '../src/index.js';

async function withServer(config, callback) {
  const server = createApp(config).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function withUpstream(callback) {
  let receivedPayload = null;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    receivedPayload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    res.end(Buffer.from('fake-audio'));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`, () => receivedPayload);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('health endpoint and tag endpoint work without Fish configuration', async () => {
  await withServer({}, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/healthz`).then((response) => response.json());
    assert.equal(health.ok, true);
    const response = await fetch(`${baseUrl}/api/tts/tag`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '[whisper] come here' })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).taggedText, '[whisper] come here');
  });
});

test('helper API key protects API routes', async () => {
  await withServer({ helperApiKey: 'secret' }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/tts/tag`, { method: 'POST' })).status, 401);
    const response = await fetch(`${baseUrl}/api/tts/tag`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fish-helper-key': 'secret' },
      body: JSON.stringify({ text: 'hello' })
    });
    assert.equal(response.status, 200);
  });
});

test('invalid model limits return 400 without contacting Fish', async () => {
  await withServer({ fishApiKey: 'configured' }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/fish/models?q=test&limit=garbage`);
    assert.equal(response.status, 400);
  });
});

test('audio route uses the default voice and preserves explicit tags upstream', async () => {
  await withUpstream(async (fishBaseUrl, getPayload) => {
    await withServer({ fishApiKey: 'configured', fishBaseUrl, defaultVoiceId: 'default-voice' }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/tts/audio`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '[whisper] come here', format: 'mp3' })
      });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'fake-audio');
      assert.deepEqual(getPayload(), {
        text: '[whisper] come here',
        reference_id: 'default-voice',
        format: 'mp3',
        latency: 'low'
      });
    });
  });
});

test('remote binding requires helper authentication', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
  assert.throws(() => startServer({ host: '0.0.0.0', port: 0, helperApiKey: '' }), /Refusing to bind/);
});
