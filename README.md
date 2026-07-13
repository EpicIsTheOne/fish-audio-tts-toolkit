# fish-audio-tts-toolkit

Standalone Fish Audio helper repo extracted from the AICHAT / NEXUS Fish TTS work.

This repo includes:

- **Fish Audio voice search system**
- **automatic TTS delivery/emotion tagging**
- **HTTP helper service** for tagging + synthesis
- **Python example** that auto-tags text, sends it to Fish Audio, and plays it
- enough documentation that Codex can ingest it without having a stroke

---

## What this is

This is a reusable toolkit for projects that want better Fish Audio TTS behavior.

Instead of sending raw text straight into Fish Audio and hoping for the best, this toolkit can:

1. **normalize** messy roleplay/chat text
2. **strip narration noise**
3. **infer delivery tags** like:
   - `[whisper]`
   - `[soft laugh]`
   - `[teasing amused tone]`
   - `[shaky voice]`
   - `[soft moan]`
   - `[loud moan]`
4. **search Fish voices intelligently** by name
5. **generate audio** through Fish Audio
6. optionally **stream** audio back to the caller

---

## Repo structure

```text
src/
  index.js        # Express server
  tagging.js      # auto-tagging + text normalization logic
  search.js       # Fish voice search + ranking system
  fish.js         # Fish Audio HTTP + realtime helpers
examples/python/
  auto_tag_fish_play.py
  requirements.txt
```

---

## Requirements

- Node.js 20+
- a Fish Audio API key
- Python 3.10+ if you want to run the example script

---

## Installation

```bash
git clone https://github.com/EpicIsTheOne/fish-audio-tts-toolkit.git
cd fish-audio-tts-toolkit
cp .env.example .env
npm install
```

Set your `.env`:

```env
PORT=3027
HOST=127.0.0.1
FISH_AUDIO_API_KEY=your_fish_api_key_here
FISH_AUDIO_BASE_URL=https://api.fish.audio
FISH_TTS_BACKEND=s2-pro
DEFAULT_FISH_REFERENCE_ID=
FISH_HELPER_API_KEY=
FISH_REQUEST_TIMEOUT_MS=120000
FISH_AUDIO_RATE_LIMIT=30
FISH_AUDIO_RATE_WINDOW_MS=60000
FISH_MODEL_CACHE_ENTRIES=100
```

Start it:

```bash
npm start
```

Server will come up on:

```text
http://127.0.0.1:3027
```

The helper binds only to `127.0.0.1` by default. If you deliberately set `HOST=0.0.0.0` or another remote-facing address, you must also set `FISH_HELPER_API_KEY`; startup refuses an unauthenticated remote binding.

When `FISH_HELPER_API_KEY` is set, send it with API requests using either:

```text
Authorization: Bearer YOUR_HELPER_KEY
X-Fish-Helper-Key: YOUR_HELPER_KEY
```

---

## How to use Fish Audio with this repo

### 1) Search for a voice

```bash
curl "http://127.0.0.1:3027/api/fish/models?q=egirl&limit=5"
```

### 2) Tag text without generating audio

```bash
curl -X POST http://127.0.0.1:3027/api/tts/tag \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "*she laughs softly* \"You are unbelievably cute when you fail.\""
  }'
```

Example response:

```json
{
  "ok": true,
  "input": "*she laughs softly* \"You are unbelievably cute when you fail.\"",
  "taggedText": "[soft laugh] [teasing amused tone] You are unbelievably cute when you fail.",
  "tags": ["soft laugh", "teasing amused tone"],
  "spokenText": "You are unbelievably cute when you fail."
}
```

### 3) Generate Fish Audio

```bash
curl -X POST http://127.0.0.1:3027/api/tts/audio \
  -H 'Content-Type: application/json' \
  --output output.mp3 \
  -d '{
    "text": "*she laughs softly* \"You are unbelievably cute when you fail.\"",
    "voiceId": "YOUR_FISH_REFERENCE_ID",
    "format": "mp3",
    "latency": "low"
  }'
```

### 4) Stream Fish Audio

```bash
curl -X POST http://127.0.0.1:3027/api/tts/audio \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "Say this with a teasing little laugh.",
    "voiceId": "YOUR_FISH_REFERENCE_ID",
    "stream": true
  }' \
  --output stream.mp3
```

---

## Python example: auto-tag -> send to Fish -> play audio

Install deps:

```bash
cd examples/python
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Set environment:

```bash
export FISH_HELPER_URL=http://127.0.0.1:3027/
export FISH_VOICE_ID=YOUR_FISH_REFERENCE_ID
export FISH_FORMAT=mp3
export FISH_LATENCY=low
```

Run it:

```bash
python auto_tag_fish_play.py '*she laughs softly* "You really thought that would work? Cute."'
```

What it does:

1. sends text to `/api/tts/tag`
2. gets the normalized/tagged version
3. sends the original text to `/api/tts/audio`
4. the helper server auto-tags it again server-side before calling Fish Audio
5. saves the returned audio to a temp file
6. plays it automatically

---

## Main API

### `GET /healthz`
Simple health probe.

### `GET /api/fish/models?q=<query>&limit=<n>`
Search Fish Audio models/voices and rank them.

### `POST /api/tts/tag`
Request body:

```json
{
  "text": "your text here",
  "includeAsteriskNarration": false
}
```

### `POST /api/tts/audio`
Request body:

```json
{
  "text": "your text here",
  "voiceId": "fish_reference_id (optional when DEFAULT_FISH_REFERENCE_ID is set)",
  "format": "mp3",
  "latency": "low",
  "includeAsteriskNarration": false,
  "stream": false
}
```

Accepted `format` values:
- `mp3`
- `wav`
- `opus`
- `pcm`

Accepted `latency` values:
- `low`
- `normal`
- `balanced`

---

## How the Fish voice search system works

The search system does more than plain title matching.

It ranks candidate Fish models using:

- exact title match
- prefix match
- substring match
- shared token overlap
- popularity-ish hints (`task_count`, `like_count`)
- language hints
- gender-ish hints
- tag hints (like anime / young)

That means searches like:

- `egirl`
- `anime girl`
- `british woman`
- `kuudere princess`

…have a better chance of landing on the least stupid result.

---

## How the TTS tag system works

The auto-tagger is **deterministic** in this standalone repo.

It looks for textual delivery cues and maps them to Fish-friendly tags.

Examples:

- `whispers softly` -> `[whisper]` / `[soft gentle tone]`
- `laughs softly` -> `[soft laugh]`
- `teasingly` -> `[teasing amused tone]`
- `voice trembling` -> `[shaky voice]`
- `moans softly` -> `[soft moan]`
- `desperate loud moan` -> `[loud moan]`

It also cleans ugly input:

- strips emoji
- removes junk markup
- normalizes repeated moan-like tokens
- strips some narration noise before synthesis

If text already contains inline Fish tags like:

```text
[whisper] come here
```

…it preserves recognized square-bracket tags exactly where they appear in the text sent to Fish. Parentheses and unknown bracketed phrases remain ordinary speech, preventing accidental commands from normal prose.

Explicit tags are never duplicated for intensity. Automatically inferred high-intensity tags may still be repeated intentionally.

Markdown bold and simple underscore emphasis are unwrapped without deleting their text; identifiers such as `_snake_case_` are preserved. Single-asterisk roleplay actions are removed unless `includeAsteriskNarration` is enabled.

---

## Development checks

```bash
npm test
npm run check
npm audit
```

The tests cover explicit emotion tags, narration cleanup, streaming formats, cache bounds, API authentication, local binding safety, and request validation.

---

## Notes for Codex / reuse in another project

If you want Codex to consume this repo for another app:

- use `src/tagging.js` if you only want auto-tagging logic
- use `src/search.js` if you only want Fish voice search/ranking
- use `src/fish.js` if you only want Fish TTS calls
- use `src/index.js` if you want the whole helper API as a standalone microservice

This repo is intentionally split so another project can:

- import the modules directly, or
- run the server as a sidecar helper

---

## Example integration flow

1. User types a line
2. Your app decides which Fish voice/reference ID to use
3. Optional: call `/api/fish/models?q=...` to discover a voice
4. Call `/api/tts/tag` for preview/debug
5. Call `/api/tts/audio` for actual synthesis
6. Play returned audio in browser / desktop / python app

---

## Caveats

- Fish Audio model availability can change
- some model metadata on Fish is messy, so ranking is heuristic
- erotic/nonverbal vocal cues are supported because that was part of the original AICHAT behavior, but you should obviously use your brain depending on project context
- this standalone repo keeps the tagger deterministic and lightweight instead of dragging in the whole original app stack

---

## License

MIT
