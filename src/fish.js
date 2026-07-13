import { FishAudioClient, RealtimeEvents } from 'fish-audio';
import { normalizeTtsText } from './tagging.js';

export function getTtsContentType(format = 'mp3') {
  if (format === 'wav') return 'audio/wav';
  if (format === 'opus') return 'audio/ogg; codecs=opus';
  if (format === 'pcm') return 'application/octet-stream';
  return 'audio/mpeg';
}

export function buildDirectFishTtsSettings({ voiceId, format = 'mp3', latency = 'low', includeAsteriskNarration = false } = {}) {
  return {
    fishReferenceId: String(voiceId || '').trim(),
    ttsFormat: ['wav', 'pcm', 'mp3', 'opus'].includes(String(format || '').trim()) ? String(format || '').trim() : 'mp3',
    ttsLatency: ['low', 'normal', 'balanced'].includes(String(latency || '').trim()) ? String(latency || '').trim() : 'low',
    ttsReadNarration: includeAsteriskNarration === true
  };
}

export function buildFishTtsPayload({ text, settings }) {
  return {
    text: normalizeTtsText(text),
    reference_id: String(settings.fishReferenceId || '').trim(),
    format: settings.ttsFormat || 'mp3',
    latency: settings.ttsLatency || 'low'
  };
}

export function buildFishRealtimePayload({ settings, format = 'mp3' }) {
  return {
    text: '',
    reference_id: String(settings.fishReferenceId || '').trim(),
    format: ['wav', 'pcm', 'mp3', 'opus'].includes(String(format || '').trim()) ? String(format || '').trim() : 'mp3',
    latency: ['low', 'normal', 'balanced'].includes(String(settings.ttsLatency || '').trim()) ? String(settings.ttsLatency || '').trim() : 'low',
    chunk_length: 140,
    condition_on_previous_chunks: true,
    normalize: true
  };
}

export async function callFishTTS({ apiKey, baseUrl, backend = 's2-pro', payload, signal = AbortSignal.timeout(120000) }) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/tts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      model: backend
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(detail || `Fish Audio request failed (${response.status})`);
    error.statusCode = response.status === 401 || response.status === 402 ? 502 : 503;
    throw error;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    const error = new Error('Fish Audio returned empty audio');
    error.statusCode = 502;
    throw error;
  }

  return { buffer, contentType: response.headers.get('content-type') || getTtsContentType(payload.format) };
}

export async function streamFishTts({ apiKey, baseUrl, backend = 's2-pro', text, settings, onOpen = null, onChunk = null, signal = null }) {
  const fishAudioClient = new FishAudioClient({ apiKey, baseUrl });
  const request = buildFishRealtimePayload({ settings, format: settings.ttsFormat });
  const connection = await fishAudioClient.textToSpeech.convertRealtime(request, (async function* generate() {
    yield normalizeTtsText(text);
  })(), backend);

  let bytesReceived = 0;
  let settled = false;

  return await new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', handleAbort);
    const finishSuccess = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ bytesReceived });
    };
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { connection.close(); } catch {}
      reject(error instanceof Error ? error : new Error(String(error || 'Fish realtime streaming failed')));
    };
    const handleAbort = () => {
      const error = new Error('Fish realtime streaming was aborted');
      error.name = 'AbortError';
      finishError(error);
    };

    connection.on(RealtimeEvents.OPEN, () => { if (onOpen) onOpen(); });
    connection.on(RealtimeEvents.AUDIO_CHUNK, (chunk) => {
      const buffer = Buffer.from(chunk);
      if (!buffer.length) return;
      bytesReceived += buffer.length;
      if (onChunk) onChunk(buffer);
    });
    connection.on(RealtimeEvents.ERROR, (error) => finishError(error));
    connection.on(RealtimeEvents.CLOSE, () => finishSuccess());
    if (signal?.aborted) handleAbort();
    else signal?.addEventListener('abort', handleAbort, { once: true });
  });
}
