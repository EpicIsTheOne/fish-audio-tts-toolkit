import 'dotenv/config';
import express from 'express';
import { tagTtsText, formatTtsEmotionTags } from './tagging.js';
import { searchFishModelsByName } from './search.js';
import { buildDirectFishTtsSettings, buildFishTtsPayload, callFishTTS, streamFishTts } from './fish.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3027);
const FISH_AUDIO_API_KEY = process.env.FISH_AUDIO_API_KEY || '';
const FISH_AUDIO_BASE_URL = (process.env.FISH_AUDIO_BASE_URL || 'https://api.fish.audio').replace(/\/$/, '');
const FISH_TTS_BACKEND = String(process.env.FISH_TTS_BACKEND || 's2-pro').trim() || 's2-pro';
const modelCache = new Map();
const modelCacheTtlMs = 5 * 60 * 1000;

function requireFishConfig(_req, res, next) {
  if (!FISH_AUDIO_API_KEY) return res.status(503).json({ ok: false, error: 'Fish Audio is not configured. Set FISH_AUDIO_API_KEY.' });
  next();
}

function setTaggedAudioHeaders(res, { taggedText = '', tags = [], spokenText = '', mode = 'full' } = {}) {
  res.setHeader('X-TTS-Mode', mode);
  res.setHeader('X-TTS-Tagged-Text', encodeURIComponent(String(taggedText || '').slice(0, 1800)));
  res.setHeader('X-TTS-Emotion-Tag', formatTtsEmotionTags(tags) || 'NONE');
  res.setHeader('X-TTS-Tags', encodeURIComponent(JSON.stringify(tags || [])));
  res.setHeader('X-TTS-Spoken-Text', encodeURIComponent(String(spokenText || '').slice(0, 1800)));
}

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, fishConfigured: Boolean(FISH_AUDIO_API_KEY), backend: FISH_TTS_BACKEND });
});

app.get('/api/fish/models', requireFishConfig, async (req, res) => {
  try {
    const query = String(req.query.q || req.query.query || req.query.title || '').trim();
    const limit = Math.max(1, Math.min(20, Number(req.query.limit || 8)));
    const result = await searchFishModelsByName(query, {
      apiKey: FISH_AUDIO_API_KEY,
      baseUrl: FISH_AUDIO_BASE_URL,
      cache: modelCache,
      ttlMs: modelCacheTtlMs,
      limit,
      pageSize: Math.max(limit, 12)
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 503).json({ ok: false, error: 'Fish voice lookup failed', detail: String(error?.message || error), items: [], bestMatch: null });
  }
});

app.post('/api/tts/tag', async (req, res) => {
  try {
    const { text, includeAsteriskNarration = false } = req.body || {};
    const result = await tagTtsText({ text, includeAsteriskNarration });
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: String(error?.message || error) });
  }
});

app.post('/api/tts/audio', requireFishConfig, async (req, res) => {
  try {
    const { text, voiceId, fishReferenceId, referenceId, format = 'mp3', latency = 'low', includeAsteriskNarration = false, stream = false } = req.body || {};
    const resolvedVoiceId = String(voiceId || fishReferenceId || referenceId || '').trim();
    if (!resolvedVoiceId) return res.status(400).json({ ok: false, error: 'voiceId/referenceId is required' });

    const tagResult = await tagTtsText({ text, includeAsteriskNarration });
    const settings = buildDirectFishTtsSettings({ voiceId: resolvedVoiceId, format, latency, includeAsteriskNarration });
    const payload = buildFishTtsPayload({ text: tagResult.taggedText, settings });

    if (stream === true || String(stream).toLowerCase() === 'true') {
      res.status(200);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-store');
      setTaggedAudioHeaders(res, { taggedText: tagResult.taggedText, tags: tagResult.tags, spokenText: tagResult.spokenText, mode: 'stream' });
      await streamFishTts({
        apiKey: FISH_AUDIO_API_KEY,
        baseUrl: FISH_AUDIO_BASE_URL,
        backend: FISH_TTS_BACKEND,
        text: tagResult.taggedText,
        settings,
        onChunk: (buffer) => res.write(buffer)
      });
      return res.end();
    }

    const audio = await callFishTTS({ apiKey: FISH_AUDIO_API_KEY, baseUrl: FISH_AUDIO_BASE_URL, backend: FISH_TTS_BACKEND, payload });
    res.status(200);
    res.setHeader('Content-Type', audio.contentType);
    res.setHeader('Cache-Control', 'no-store');
    setTaggedAudioHeaders(res, { taggedText: tagResult.taggedText, tags: tagResult.tags, spokenText: tagResult.spokenText, mode: 'full' });
    res.end(audio.buffer);
  } catch (error) {
    if (!res.headersSent) res.status(error.statusCode || 503).json({ ok: false, error: 'TTS unavailable', detail: String(error?.message || error) });
    else res.end();
  }
});

app.listen(PORT, () => {
  console.log(`fish-audio-tts-toolkit listening on http://localhost:${PORT}`);
});
