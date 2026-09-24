import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp, isLoopbackHost, loadConfig, startServer } from '../src/index.js';

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
  let receivedModel = null;
  const server = createServer(async (req, res) => {
    receivedModel = req.headers.model;
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
    await callback(`http://127.0.0.1:${port}`, () => receivedPayload, () => receivedModel);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('health endpoint and tag endpoint work without Fish configuration', async () => {
  await withServer({}, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/healthz`).then((response) => response.json());
    assert.equal(health.ok, true);
    assert.equal(health.backend, 'drama-3-preview');
    const response = await fetch(`${baseUrl}/api/tts/tag`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '[whisper] come here' })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).taggedText, '[Speak in a close, soft whisper.] come here');
  });
});

test('legacy tagger remains available by request and configuration', async () => {
  assert.equal(loadConfig({ FISH_TTS_BACKEND: 's2-pro' }).fishBackend, 's2-pro');
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tts/tag`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '[whisper] come here', backend: 's2-pro' })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).taggedText, '[whisper] come here');
  });
});

test('legacy audio backend can override Drama 3 per request', async () => {
  await withUpstream(async (fishBaseUrl, getPayload, getModel) => {
    await withServer({ fishApiKey: 'configured', fishBaseUrl, defaultVoiceId: 'voice' }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/tts/audio`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '[whisper] Hello.', backend: 's2-pro' })
      });
      assert.equal(response.status, 200);
      assert.equal(getModel(), 's2-pro');
      assert.equal(getPayload().text, '[whisper] Hello.');
      assert.equal(getPayload().latency, 'low');
      assert.equal(response.headers.get('x-tts-tagger'), 'legacy');
    });
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
    await withServer({ fishApiKey: 'configured', fishBaseUrl, defaultVoiceId: 'default-voice', fishBackend: 's2-pro' }, async (baseUrl) => {
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

test('audio route sends correctly placed narration tags to Fish', async () => {
  await withUpstream(async (fishBaseUrl, getPayload) => {
    await withServer({ fishApiKey: 'configured', fishBaseUrl, defaultVoiceId: 'voice', fishBackend: 's2-pro' }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/tts/audio`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '*she whispers* "Hello." *she shouts* "Run!"' })
      });
      assert.equal(response.status, 200);
      assert.equal(getPayload().text, '[whisper] Hello. [loud] Run!');
    });
  });
});

test('default audio uses Drama 3 model header and natural-language directions', async () => {
  await withUpstream(async (fishBaseUrl, getPayload, getModel) => {
    await withServer({ fishApiKey: 'configured', fishBaseUrl, defaultVoiceId: 'voice' }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/tts/audio`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '*she whispers* "Come closer."', direction: 'Start slowly.' })
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-tts-backend'), 'drama-3-preview');
      assert.equal(response.headers.get('x-tts-tagger'), 'drama3');
      assert.equal(getModel(), 'drama-3-preview');
      assert.deepEqual(getPayload(), {
        text: '[Start slowly.] [Speak in a close, soft whisper.] Come closer.',
        reference_id: 'voice', format: 'mp3', latency: 'normal'
      });
    });
  });
});

test('Drama 3 sends multiple voice IDs with speaker markers', async () => {
  await withUpstream(async (fishBaseUrl, getPayload) => {
    await withServer({ fishApiKey: 'configured', fishBaseUrl }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/tts/audio`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: '<|speaker:0|>Hello. <|speaker:1|>[whisper] Stay close.',
          voiceIds: ['alice', 'bob']
        })
      });
      assert.equal(response.status, 200);
      assert.deepEqual(getPayload().reference_id, ['alice', 'bob']);
      assert.equal(getPayload().text,
        '<|speaker:0|>Hello. <|speaker:1|>[Speak in a close, soft whisper.] Stay close.');
    });
  });
});

test('invalid backend and speaker indexes are rejected before Fish is called', async () => {
  await withServer({ fishApiKey: 'configured', defaultVoiceId: 'voice' }, async (baseUrl) => {
    for (const body of [
      { text: 'Hello.', backend: 'unknown' },
      { text: '<|speaker:1|>Hello.', voiceIds: ['only-one'] },
      { text: '<|speaker:1|>Hello.' }
    ]) {
      const response = await fetch(`${baseUrl}/api/tts/audio`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      assert.equal(response.status, 400);
    }
  });
});

test('remote binding requires helper authentication', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
  assert.throws(() => startServer({ host: '0.0.0.0', port: 0, helperApiKey: '' }), /Refusing to bind/);
});

test('empty realtime output returns an upstream error instead of successful audio', async () => {
  const upstream = createServer();
  const websocket = new WebSocketServer({ server: upstream, path: '/v1/tts/live' });
  let selectedModel;
  websocket.on('connection', (client, request) => {
    selectedModel = request.headers.model;
    client.close();
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const fishBaseUrl = `http://127.0.0.1:${upstream.address().port}`;
  try {
    await withServer({ fishApiKey: 'configured', fishBaseUrl, defaultVoiceId: 'voice' }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/tts/audio`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello', stream: true })
      });
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error, 'TTS unavailable');
      assert.equal(selectedModel, 'drama-3-preview');
    });
  } finally {
    websocket.close();
    upstream.close();
    await once(upstream, 'close');
  }
});
