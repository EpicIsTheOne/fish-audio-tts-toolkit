import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDirectFishTtsSettings, buildFishRealtimePayload, getTtsContentType } from '../src/fish.js';

test('realtime payload preserves every supported requested format', () => {
  for (const format of ['mp3', 'wav', 'opus', 'pcm']) {
    const settings = buildDirectFishTtsSettings({ voiceId: 'voice-1', format });
    const payload = buildFishRealtimePayload({ settings, format: settings.ttsFormat });
    assert.equal(payload.format, format);
  }
});

test('content types match supported formats', () => {
  assert.equal(getTtsContentType('mp3'), 'audio/mpeg');
  assert.equal(getTtsContentType('wav'), 'audio/wav');
  assert.equal(getTtsContentType('opus'), 'audio/ogg; codecs=opus');
  assert.equal(getTtsContentType('pcm'), 'application/octet-stream');
});
