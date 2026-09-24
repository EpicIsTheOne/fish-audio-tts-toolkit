import 'dotenv/config';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { tagTtsText, formatTtsEmotionTags } from './tagging.js';
import { DRAMA3_BACKEND, tagDrama3Text } from './drama3.js';
import { searchFishModelsByName } from './search.js';
import { buildDirectFishTtsSettings, buildFishTtsPayload, callFishTTS, getTtsContentType, streamFishTts } from './fish.js';

function parsePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function loadConfig(env = process.env) {
  return {
    port: parsePositiveInteger(env.PORT, 3027, { max: 65535 }),
    host: String(env.HOST || '127.0.0.1').trim() || '127.0.0.1',
    fishApiKey: String(env.FISH_AUDIO_API_KEY || ''),
    fishBaseUrl: String(env.FISH_AUDIO_BASE_URL || 'https://api.fish.audio').replace(/\/$/, ''),
    fishBackend: String(env.FISH_TTS_BACKEND || DRAMA3_BACKEND).trim() || DRAMA3_BACKEND,
    defaultVoiceId: String(env.DEFAULT_FISH_REFERENCE_ID || '').trim(),
    helperApiKey: String(env.FISH_HELPER_API_KEY || '').trim(),
    requestTimeoutMs: parsePositiveInteger(env.FISH_REQUEST_TIMEOUT_MS, 120000, { min: 1000, max: 600000 }),
    audioRateLimit: parsePositiveInteger(env.FISH_AUDIO_RATE_LIMIT, 30, { min: 1, max: 10000 }),
    audioRateWindowMs: parsePositiveInteger(env.FISH_AUDIO_RATE_WINDOW_MS, 60000, { min: 1000, max: 3600000 }),
    modelCacheEntries: parsePositiveInteger(env.FISH_MODEL_CACHE_ENTRIES, 100, { min: 1, max: 1000 })
  };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function createHelperAuthMiddleware(helperApiKey) {
  return (req, res, next) => {
    if (!helperApiKey) return next();
    const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const suppliedKey = bearer || req.get('x-fish-helper-key') || '';
    if (!safeEqual(suppliedKey, helperApiKey)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    next();
  };
}

function createRateLimitMiddleware({ maxRequests, windowMs }) {
  const clients = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const current = clients.get(key);
    const entry = !current || now >= current.resetAt ? { count: 0, resetAt: now + windowMs } : current;
    entry.count += 1;
    clients.set(key, entry);
    res.setHeader('RateLimit-Limit', maxRequests);
    res.setHeader('RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    res.setHeader('RateLimit-Reset', Math.ceil(entry.resetAt / 1000));
    if (entry.count > maxRequests) return res.status(429).json({ ok: false, error: 'Too many audio requests' });
    if (clients.size > 1000) {
      for (const [clientKey, value] of clients) if (now >= value.resetAt) clients.delete(clientKey);
    }
    next();
  };
}

function setTaggedAudioHeaders(res, { taggedText = '', tags = [], spokenText = '', mode = 'full', backend = '', tagger = '' } = {}) {
  res.setHeader('X-TTS-Mode', mode);
  res.setHeader('X-TTS-Backend', backend);
  res.setHeader('X-TTS-Tagger', tagger);
  res.setHeader('X-TTS-Tagged-Text', encodeURIComponent(String(taggedText || '').slice(0, 1800)));
  res.setHeader('X-TTS-Emotion-Tag', formatTtsEmotionTags(tags) || 'NONE');
  res.setHeader('X-TTS-Tags', encodeURIComponent(JSON.stringify(tags || [])));
  res.setHeader('X-TTS-Spoken-Text', encodeURIComponent(String(spokenText || '').slice(0, 1800)));
}

function getRequestLimit(rawLimit) {
  if (rawLimit === undefined) return 8;
  const limit = Number(rawLimit);
  return Number.isInteger(limit) && limit >= 1 && limit <= 20 ? limit : null;
}

function getErrorStatus(error, fallback = 503) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 504;
  return error?.statusCode || fallback;
}

function resolveBackend(requested, configured) {
  const backend = requested === undefined || requested === null || requested === '' ? configured : requested;
  if (typeof backend !== 'string' || ![DRAMA3_BACKEND, 's2-pro', 's2.1-pro', 's2.1-pro-free'].includes(backend)) {
    const error = new Error('Unsupported TTS backend');
    error.statusCode = 400;
    throw error;
  }
  return backend;
}

function resolveVoiceSelection(body, defaultVoiceId) {
  const text = String(body.text || '');
  const markers = [...text.matchAll(/<\|speaker:(\d+)\|>/g)].map((match) => Number(match[1]));
  if (body.voiceIds !== undefined) {
    if (!Array.isArray(body.voiceIds) || body.voiceIds.length < 1 || body.voiceIds.length > 8
      || body.voiceIds.some((id) => typeof id !== 'string' || !id.trim())) {
      const error = new Error('voiceIds must contain 1 to 8 nonempty voice IDs');
      error.statusCode = 400;
      throw error;
    }
    const voiceIds = body.voiceIds.map((id) => id.trim());
    if (voiceIds.length > 1 && !markers.length || markers.some((index) => index >= voiceIds.length)) {
      const error = new Error('Speaker markers must match voiceIds indexes');
      error.statusCode = 400;
      throw error;
    }
    return { voiceIds };
  }
  const voiceId = String(body.voiceId || body.fishReferenceId || body.referenceId || defaultVoiceId || '').trim();
  if (!voiceId) {
    const error = new Error('voiceId/referenceId is required when DEFAULT_FISH_REFERENCE_ID is not set');
    error.statusCode = 400;
    throw error;
  }
  if (markers.some((index) => index > 0)) {
    const error = new Error('Multiple speaker markers require voiceIds');
    error.statusCode = 400;
    throw error;
  }
  return { voiceId };
}

function tagForBackend(backend, options) {
  return backend === DRAMA3_BACKEND ? tagDrama3Text(options) : tagTtsText(options);
}

export function createApp(configOverrides = {}) {
  const config = { ...loadConfig(), ...configOverrides };
  resolveBackend(config.fishBackend, DRAMA3_BACKEND);
  const app = express();
  const modelCache = new Map();
  const audioRateLimit = createRateLimitMiddleware({ maxRequests: config.audioRateLimit, windowMs: config.audioRateWindowMs });

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createHelperAuthMiddleware(config.helperApiKey));

  function requireFishConfig(_req, res, next) {
    if (!config.fishApiKey) return res.status(503).json({ ok: false, error: 'Fish Audio is not configured. Set FISH_AUDIO_API_KEY.' });
    next();
  }

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, fishConfigured: Boolean(config.fishApiKey), defaultVoiceConfigured: Boolean(config.defaultVoiceId), backend: config.fishBackend });
  });

  app.get('/api/fish/models', requireFishConfig, async (req, res) => {
    try {
      const query = String(req.query.q || req.query.query || req.query.title || '').trim();
      const limit = getRequestLimit(req.query.limit);
      if (limit === null) return res.status(400).json({ ok: false, error: 'limit must be an integer from 1 to 20' });
      const result = await searchFishModelsByName(query, {
        apiKey: config.fishApiKey,
        baseUrl: config.fishBaseUrl,
        cache: modelCache,
        ttlMs: 5 * 60 * 1000,
        maxCacheEntries: config.modelCacheEntries,
        limit,
        pageSize: Math.max(limit, 12),
        signal: AbortSignal.timeout(Math.min(config.requestTimeoutMs, 30000))
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(getErrorStatus(error)).json({ ok: false, error: 'Fish voice lookup failed', detail: String(error?.message || error), items: [], bestMatch: null });
    }
  });

  app.post('/api/tts/tag', async (req, res) => {
    try {
      const { text, includeAsteriskNarration = false, mode = 'conservative', direction, backend: requestedBackend } = req.body || {};
      const backend = resolveBackend(requestedBackend, config.fishBackend);
      const result = await tagForBackend(backend, { text, includeAsteriskNarration, mode, direction });
      res.json({ ...result, backend, tagger: backend === DRAMA3_BACKEND ? 'drama3' : 'legacy' });
    } catch (error) {
      res.status(getErrorStatus(error, 500)).json({ ok: false, error: String(error?.message || error) });
    }
  });

  app.post('/api/tts/audio', requireFishConfig, audioRateLimit, async (req, res) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    const abortOnDisconnect = () => controller.abort();
    req.once('aborted', abortOnDisconnect);
    res.once('close', abortOnDisconnect);

    try {
      const { text, format = 'mp3', latency, includeAsteriskNarration = false, mode = 'conservative', stream = false, direction, backend: requestedBackend } = req.body || {};
      const backend = resolveBackend(requestedBackend, config.fishBackend);
      const voiceSelection = resolveVoiceSelection(req.body || {}, config.defaultVoiceId);
      const tagResult = await tagForBackend(backend, { text, includeAsteriskNarration, mode, direction });
      const settings = buildDirectFishTtsSettings({ ...voiceSelection, format, latency: latency || (backend === DRAMA3_BACKEND ? 'normal' : 'low'), includeAsteriskNarration });
      const payload = buildFishTtsPayload({ text: tagResult.taggedText, settings });

      if (stream === true || String(stream).toLowerCase() === 'true') {
        res.status(200);
        res.setHeader('Content-Type', getTtsContentType(settings.ttsFormat));
        res.setHeader('Cache-Control', 'no-store');
        setTaggedAudioHeaders(res, { taggedText: tagResult.taggedText, tags: tagResult.tags, spokenText: tagResult.spokenText, mode: 'stream', backend, tagger: backend === DRAMA3_BACKEND ? 'drama3' : 'legacy' });
        await streamFishTts({
          apiKey: config.fishApiKey,
          baseUrl: config.fishBaseUrl,
          backend,
          text: tagResult.taggedText,
          settings,
          signal: controller.signal,
          onChunk: (buffer) => res.write(buffer)
        });
        return res.end();
      }

      const audio = await callFishTTS({
        apiKey: config.fishApiKey,
        baseUrl: config.fishBaseUrl,
        backend,
        payload,
        signal: controller.signal
      });
      res.status(200);
      res.setHeader('Content-Type', audio.contentType);
      res.setHeader('Cache-Control', 'no-store');
      setTaggedAudioHeaders(res, { taggedText: tagResult.taggedText, tags: tagResult.tags, spokenText: tagResult.spokenText, mode: 'full', backend, tagger: backend === DRAMA3_BACKEND ? 'drama3' : 'legacy' });
      res.end(audio.buffer);
    } catch (error) {
      if (!res.headersSent) res.status(getErrorStatus(error)).json({ ok: false, error: 'TTS unavailable', detail: String(error?.message || error) });
      else res.destroy();
    } finally {
      clearTimeout(timeout);
      req.off('aborted', abortOnDisconnect);
      res.off('close', abortOnDisconnect);
    }
  });

  return app;
}

export function isLoopbackHost(host) {
  return ['127.0.0.1', '::1', 'localhost'].includes(String(host || '').toLowerCase());
}

export function startServer(configOverrides = {}) {
  const config = { ...loadConfig(), ...configOverrides };
  if (!isLoopbackHost(config.host) && !config.helperApiKey) {
    throw new Error('Refusing to bind Fish helper remotely without FISH_HELPER_API_KEY');
  }
  const app = createApp(config);
  return app.listen(config.port, config.host, () => {
    console.log(`fish-audio-tts-toolkit listening on http://${config.host}:${config.port}`);
  });
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath && fileURLToPath(import.meta.url) === entryPath) startServer();
