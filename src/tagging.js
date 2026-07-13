export function normalizeMoanLikeToken(token = '') {
  const raw = String(token || '').trim();
  if (!raw) return raw;
  const plain = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (!plain) return raw;

  if (/^a+h+n+$/.test(plain) || /^a+h+m+$/.test(plain)) {
    const aCount = (plain.match(/a/g) || []).length;
    const nCount = (plain.match(/n/g) || []).length;
    return aCount >= 3 || nCount >= 3 || plain.length >= 8 ? 'Aaaahn!' : 'Ahn';
  }
  if (/^a+h+$/.test(plain) || /^o+h+$/.test(plain)) {
    const vowelCount = (plain.match(/[ao]/g) || []).length;
    const hCount = (plain.match(/h/g) || []).length;
    return vowelCount >= 3 || hCount >= 4 || plain.length >= 6 ? 'Aaaah!' : 'Ahh';
  }
  if (/^m+m+m+$/.test(plain)) return 'Mmm';
  if (/^m+m+h+$/.test(plain) || /^m+p+h+$/.test(plain) || /^u+m+m+h+$/.test(plain)) return 'Mm';
  if (/^n+g+h+$/.test(plain) || /^u+n+n+h+$/.test(plain)) return 'Ngh';
  return raw;
}

export function normalizeTtsMoans(value = '') {
  let text = String(value || '');
  const vocalization = /(?<![\[(])\b(?:a+h+n+|a+h+m+|a+h+|o+h+|m{2,}|m{2,}h+|m+p+h+|u+m{2,}h+|n+g+h+|u+n{2,}h+)\b[~!?,.-]*(?![\])])/gi;
  text = text.replace(vocalization, (token) => normalizeMoanLikeToken(token));
  text = text.replace(/\b(?:Ahh\s*){2,}/gi, 'Ahh ');
  text = text.replace(/\b(?:Ahn\s*){2,}/gi, 'Ahn ');
  text = text.replace(/\b(?:Mm\s*){2,}/gi, 'Mm ');
  text = text.replace(/\b(?:Mmm\s*){2,}/gi, 'Mmm ');
  text = text.replace(/\b(?:Ngh\s*){2,}/gi, 'Ngh ');
  return text.replace(/\s+/g, ' ').trim();
}

export function stripEmojiForTts(value = '') {
  return String(value || '')
    .replace(/[0-9#*]\uFE0F?\u20E3/gu, ' ')
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, ' ')
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, ' ')
    .replace(/[\uFE0F\u200D]/g, ' ');
}

export function cleanTtsSpeechText(value = '') {
  return String(value || '')
    .replace(/#/g, ' ')
    .replace(/^[\s:;,.;!?—-]+/g, '')
    .replace(/[\s:;—-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTtsText(value = '') {
  const text = stripEmojiForTts(normalizeTtsMoans(String(value || '')))
    .replace(/~/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) {
    const error = new Error('Text is required');
    error.statusCode = 400;
    throw error;
  }
  if (text.length > 2500) {
    const error = new Error('Text is too long for TTS');
    error.statusCode = 422;
    throw error;
  }
  return text;
}

const KNOWN_FISH_EMOTION_TAGS = new Set([
  'whisper', 'quiet voice', 'soft gentle tone', 'sigh', 'soft laugh', 'chuckle', 'laughing',
  'soft gasp', 'gasp', 'whimper', 'loud moan', 'soft moan', 'breathless', 'shaky voice',
  'sad soft voice', 'crying', 'nervous hesitant voice', 'shy soft voice', 'sharp irritated tone',
  'stern serious tone', 'deadpan', 'teasing amused tone', 'sarcastic', 'excited bright voice',
  'surprised', 'calm steady tone', 'commanding voice', 'loud', 'screaming', 'happy', 'sad',
  'angry', 'fearful', 'disgusted', 'calm', 'serious', 'excited', 'nervous', 'shout'
]);

function normalizeEmotionTagName(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z\s-]/g, '').replace(/\s+/g, ' ').trim();
}

function replaceRecognizedEmotionTags(value = '', replacer) {
  return String(value || '').replace(/\[([a-z][a-z\s-]{1,40})\]/gi, (match, rawTag) => {
    const tag = normalizeEmotionTagName(rawTag);
    return KNOWN_FISH_EMOTION_TAGS.has(tag) ? replacer(match, tag) : match;
  });
}

export function hasInlineFishEmotionTags(value = '') {
  let found = false;
  replaceRecognizedEmotionTags(value, (match) => {
    found = true;
    return match;
  });
  return found;
}

export function stripInlineFishEmotionTags(value = '') {
  const stripped = replaceRecognizedEmotionTags(value, () => ' ').replace(/\s+([,.;!?])/g, '$1').replace(/\s+/g, ' ').trim();
  return cleanTtsSpeechText(stripped);
}

const TTS_DELIVERY_CUES = [
  { tag: 'whisper', category: 'volume', weight: 5, patterns: [/\bwhisper(?:ing|s|ed)?\b/i, /\bmurmur(?:ing|s|ed)?\b/i, /\bhushed(?:ly)?\b/i] },
  { tag: 'quiet voice', category: 'volume', weight: 3, patterns: [/\bquiet(?:ly)?\b/i, /\blow voice\b/i, /\bsoft voice\b/i] },
  { tag: 'soft gentle tone', category: 'delivery', weight: 3, patterns: [/\bsoft(?:ly)?\b/i, /\bgentl(?:e|y)\b/i, /\btender(?:ly)?\b/i, /\bwarm(?:ly)?\b/i] },
  { tag: 'sigh', category: 'nonverbal', weight: 5, patterns: [/\bsigh(?:ing|s|ed)?\b/i, /\bexhale(?:s|d|ing)?\b/i] },
  { tag: 'soft laugh', category: 'nonverbal', weight: 6, patterns: [/\blaugh(?:ing|s|ed)?\s+softly\b/i, /\bsoft(?:ly)?\s+laugh(?:s|ed|ing)?\b/i] },
  { tag: 'chuckle', category: 'nonverbal', weight: 4, patterns: [/\bchuckl(?:e|es|ed|ing)\b/i, /\bgiggl(?:e|es|ed|ing)\b/i] },
  { tag: 'laughing', category: 'nonverbal', weight: 4, patterns: [/\blaugh(?:ing|s|ed)?\b/i] },
  { tag: 'soft gasp', category: 'nonverbal', weight: 6, patterns: [/\bsoft\s+gasp(?:ing|s|ed)?\b/i, /\bquiet\s+gasp(?:ing|s|ed)?\b/i, /\bsmall\s+gasp(?:ing|s|ed)?\b/i] },
  { tag: 'gasp', category: 'nonverbal', weight: 4, patterns: [/\bgasp(?:ing|s|ed)?\b/i, /\bbreath catches\b/i, /\bbreath hitches\b/i] },
  { tag: 'whimper', category: 'nonverbal', weight: 7, patterns: [/\bsoft\s+whimper(?:ing|s|ed)?\b/i, /\bquiet\s+whimper(?:ing|s|ed)?\b/i, /\bsmall\s+whimper(?:ing|s|ed)?\b/i, /\bwhimper(?:ing|s|ed)?\b/i] },
  { tag: 'loud moan', category: 'nonverbal', weight: 8, patterns: [/\bloud\s+moan(?:ing|s|ed)?\b/i, /\bintense\s+moan(?:ing|s|ed)?\b/i, /\bdesperate\s+moan(?:ing|s|ed)?\b/i, /\bdeep\s+moan(?:ing|s|ed)?\b/i] },
  { tag: 'soft moan', category: 'nonverbal', weight: 6, patterns: [/\bsoft\s+moan(?:ing|s|ed)?\b/i, /\bquiet\s+moan(?:ing|s|ed)?\b/i, /\bmuffled\s+moan(?:ing|s|ed)?\b/i, /\bsmall\s+moan(?:ing|s|ed)?\b/i] },
  { tag: 'breathless', category: 'delivery', weight: 4, patterns: [/\bbreathless(?:ly)?\b/i, /\bpant(?:ing|s|ed)?\b/i] },
  { tag: 'shaky voice', category: 'delivery', weight: 5, patterns: [/\bvoice trembl(?:es|ed|ing)\b/i, /\btrembl(?:ing|es|ed)?\b/i, /\bshak(?:y|ily)\b/i] },
  { tag: 'sad soft voice', category: 'emotion', weight: 4, patterns: [/\bsad(?:ly)?\b/i, /\bmournful(?:ly)?\b/i, /\bheartbroken\b/i, /\btearful\b/i] },
  { tag: 'crying', category: 'nonverbal', weight: 5, patterns: [/\bcry(?:ing|s|ied)?\b/i, /\bsob(?:bing|s|bed)?\b/i] },
  { tag: 'nervous hesitant voice', category: 'emotion', weight: 4, patterns: [/\bnervous(?:ly)?\b/i, /\bhesitant(?:ly)?\b/i, /\banxious(?:ly)?\b/i] },
  { tag: 'shy soft voice', category: 'emotion', weight: 4, patterns: [/\bshy(?:ly)?\b/i, /\bbashful(?:ly)?\b/i, /\bflustered\b/i] },
  { tag: 'sharp irritated tone', category: 'emotion', weight: 5, patterns: [/\bangr(?:y|ily)\b/i, /\birritated(?:ly)?\b/i, /\bannoyed\b/i, /\bsnap(?:s|ped|ping)?\b/i] },
  { tag: 'stern serious tone', category: 'delivery', weight: 4, patterns: [/\bstern(?:ly)?\b/i, /\bfirm(?:ly)?\b/i, /\bgrave(?:ly)?\b/i] },
  { tag: 'deadpan', category: 'delivery', weight: 4, patterns: [/\bdeadpan\b/i, /\bflat(?:ly)?\b/i, /\bmonotone\b/i] },
  { tag: 'teasing amused tone', category: 'emotion', weight: 4, patterns: [/\bteasing(?:ly)?\b/i, /\bplayful(?:ly)?\b/i, /\bamused\b/i, /\bsmirk(?:ing|s|ed)?\b/i] },
  { tag: 'sarcastic', category: 'delivery', weight: 4, patterns: [/\bsarcastic(?:ally)?\b/i, /\bdryly\b/i] },
  { tag: 'excited bright voice', category: 'emotion', weight: 4, patterns: [/\bexcited(?:ly)?\b/i, /\beager(?:ly)?\b/i, /\bthrilled\b/i, /\benthusiastic(?:ally)?\b/i] },
  { tag: 'surprised', category: 'emotion', weight: 4, patterns: [/\bsurprised\b/i, /\bstunned\b/i, /\bstartled\b/i] },
  { tag: 'calm steady tone', category: 'delivery', weight: 3, patterns: [/\bcalm(?:ly)?\b/i, /\bsteady\b/i] },
  { tag: 'commanding voice', category: 'delivery', weight: 4, patterns: [/\bcommand(?:s|ed|ing)?\b/i, /\bauthoritative(?:ly)?\b/i] },
  { tag: 'loud', category: 'volume', weight: 4, patterns: [/\bshout(?:ing|s|ed)?\b/i, /\byell(?:ing|s|ed)?\b/i, /\bloud(?:ly)?\b/i] },
  { tag: 'screaming', category: 'volume', weight: 5, patterns: [/\bscream(?:ing|s|ed)?\b/i, /\bshriek(?:ing|s|ed)?\b/i] }
];

function isNegatedMatch(text, index) {
  let prefix = String(text || '').slice(Math.max(0, index - 48), index);
  const contrast = [...prefix.matchAll(/\b(?:but|however|yet|then)\b/gi)].at(-1);
  if (contrast) prefix = prefix.slice((contrast.index || 0) + contrast[0].length);
  return /\b(?:not|never|without|no)\b[^.!?;,:]{0,24}$/i.test(prefix)
    || /\b(?:do|does|did|is|was|were|should|would|could|can)\s+not\b[^.!?;,:]{0,24}$/i.test(prefix)
    || /\b(?:don't|doesn't|didn't|isn't|wasn't|weren't|shouldn't|wouldn't|couldn't|can't)\b[^.!?;,:]{0,24}$/i.test(prefix);
}

function countPatternMatches(text = '', pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  return [...String(text || '').matchAll(regex)].filter((match) => !isNegatedMatch(text, match.index || 0)).length;
}

export function stripRpNarrationForTts(rawText = '', options = {}) {
  const raw = String(rawText || '');
  const includeAsteriskNarration = options.includeAsteriskNarration === true;
  if (includeAsteriskNarration) return raw.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
  return raw
    .replace(/\*\*([^*]{1,500})\*\*/g, '$1')
    .replace(/\*([^*]{1,500})\*/g, ' ')
    .replace(/__([^_]{1,500})__/g, '$1')
    .replace(/(^|\s)_([^_\r\n]{1,500})_(?=\s|[.,!?;:]|$)/g, '$1$2')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function capTtsEmotionTagRepeats(tags = [], maxPerTag = 5, maxTotal = 20) {
  const counts = new Map();
  const capped = [];
  for (const tag of tags) {
    const normalized = String(tag || '').trim().toLowerCase();
    if (!normalized) continue;
    const count = counts.get(normalized) || 0;
    if (count >= maxPerTag) continue;
    counts.set(normalized, count + 1);
    capped.push(normalized);
    if (capped.length >= maxTotal) break;
  }
  return capped;
}

export function parseTtsEmotionTags(value = '') {
  const tags = [];
  replaceRecognizedEmotionTags(value, (match, tag) => {
    tags.push(tag);
    return match;
  });
  return capTtsEmotionTagRepeats(tags, 1, 24);
}

function getTtsTagIntensity(tag = '') {
  const normalized = String(tag || '').trim().toLowerCase();
  if (normalized === 'loud moan' || normalized === 'screaming') return 3;
  if (normalized === 'loud' || normalized === 'soft moan' || normalized === 'whimper') return 2;
  return 1;
}

export function getTtsTagLimitForText(text = '') {
  const length = cleanTtsSpeechText(text).length;
  if (length >= 2200) return 24;
  if (length >= 1600) return 20;
  if (length >= 1100) return 16;
  if (length >= 700) return 14;
  if (length >= 350) return 12;
  return 10;
}

export function formatTtsEmotionTags(tags = [], options = {}) {
  const maxTags = Number.isFinite(options.maxTags) ? Math.max(1, Math.min(24, Math.floor(options.maxTags))) : 10;
  const capped = capTtsEmotionTagRepeats(tags, 1, maxTags);
  const expanded = [];
  for (const tag of capped) {
    const repeat = getTtsTagIntensity(tag);
    for (let i = 0; i < repeat; i += 1) expanded.push(`[${tag}]`);
  }
  return expanded.join(' ');
}

export function inferTtsDeliveryTags(context = '', speech = '', options = {}) {
  const haystack = `${context || ''} ${speech || ''}`.replace(/\s+/g, ' ').trim();
  const maxPicked = Number.isFinite(options.maxTags) ? Math.max(1, Math.min(24, Math.floor(options.maxTags))) : 10;
  if (!haystack) return [];

  const scored = [];
  for (const cue of TTS_DELIVERY_CUES) {
    let matches = 0;
    for (const pattern of cue.patterns) matches += countPatternMatches(haystack, pattern);
    if (!matches) continue;
    scored.push({ tag: cue.tag, category: cue.category, score: cue.weight + Math.min(matches, 3) });
  }

  if (/\b(moan(?:ing|s|ed)?|a+hn+|a+hh+|u+n+n+h+|n+g+h+|m+m+h+)\b/i.test(haystack)) {
    const loud = scored.find((x) => x.tag === 'loud moan');
    const soft = scored.find((x) => x.tag === 'soft moan');
    if (loud) loud.score += 3;
    if (soft) soft.score += 2;
  }

  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  const categories = new Set();
  for (const item of scored) {
    if (picked.includes(item.tag)) continue;
    if (item.tag === 'laughing' && picked.includes('soft laugh')) continue;
    if (item.tag === 'gasp' && picked.includes('soft gasp')) continue;
    if (categories.has(item.category) && item.category !== 'nonverbal') continue;
    picked.push(item.tag);
    categories.add(item.category);
    if (picked.length >= maxPicked) break;
  }
  return picked;
}

export function renderFishDirectedTtsText(rawText = '', options = {}) {
  const raw = String(rawText || '').trim();
  const includeAsteriskNarration = options.includeAsteriskNarration === true;
  const speech = cleanTtsSpeechText(stripRpNarrationForTts(raw, { includeAsteriskNarration }));
  const maxTags = getTtsTagLimitForText(speech || raw);
  const clauses = speech.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((clause) => clause.trim()).filter(Boolean) || [];
  const clauseResults = clauses.map((clause) => ({ clause, tags: inferTtsDeliveryTags(clause, '', { maxTags }) }));
  const useClauseTags = clauses.length > 1 && clauseResults.some((result) => result.tags.length);
  if (useClauseTags) {
    const tags = capTtsEmotionTagRepeats(clauseResults.flatMap((result) => result.tags), 1, maxTags);
    const text = clauseResults.map(({ clause, tags: clauseTags }) => {
      const tagText = formatTtsEmotionTags(clauseTags, { maxTags });
      return cleanTtsSpeechText(`${tagText ? `${tagText} ` : ''}${clause}`);
    }).join(' ');
    return { text, tags };
  }

  const tags = inferTtsDeliveryTags(raw, '', { maxTags });
  const cappedTags = capTtsEmotionTagRepeats(tags, 1, maxTags);
  const tagText = formatTtsEmotionTags(cappedTags, { maxTags });
  const text = speech ? cleanTtsSpeechText(`${tagText ? `${tagText} ` : ''}${speech}`) : normalizeTtsText(raw);
  return { text, tags: cappedTags };
}

export async function tagTtsText({ text, includeAsteriskNarration = false } = {}) {
  const rawText = String(text || '').trim();
  const spokenText = cleanTtsSpeechText(stripRpNarrationForTts(rawText, { includeAsteriskNarration }));
  const normalizedText = normalizeTtsText(spokenText || rawText);

  if (hasInlineFishEmotionTags(normalizedText)) {
    const maxTags = getTtsTagLimitForText(normalizedText);
    const inlineTags = capTtsEmotionTagRepeats(parseTtsEmotionTags(normalizedText), 1, maxTags);
    const mergedTagText = inlineTags.map((tag) => `[${tag}]`).join(' ');
    const textWithoutTags = stripInlineFishEmotionTags(normalizedText);
    if (!textWithoutTags) {
      const error = new Error('Text must include speech in addition to emotion tags');
      error.statusCode = 400;
      throw error;
    }
    const taggedText = normalizedText;
    return { ok: true, input: rawText, taggedText, text: taggedText, tags: inlineTags, tag: mergedTagText, spokenText: textWithoutTags };
  }

  const directed = renderFishDirectedTtsText(rawText, { includeAsteriskNarration });
  const taggedText = normalizeTtsText(directed.text || spokenText || rawText);
  return {
    ok: true,
    input: rawText,
    taggedText,
    text: taggedText,
    tags: directed.tags,
    tag: formatTtsEmotionTags(directed.tags, { maxTags: getTtsTagLimitForText(rawText) }),
    spokenText: cleanTtsSpeechText(spokenText)
  };
}
