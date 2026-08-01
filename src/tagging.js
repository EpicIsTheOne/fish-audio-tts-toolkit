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
  // Repetition is an explicit authoring choice, not an automatic intensity dial.
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

function normalizeTagMode(mode) {
  return String(mode || '').toLowerCase() === 'expressive' ? 'expressive' : 'conservative';
}

function cueHasStrongEvidence(cue, text) {
  return cue.weight >= 4 || cue.patterns.some((pattern) => {
    const source = pattern.source.toLowerCase();
    return source.includes('whisper') || source.includes('scream') || source.includes('moan')
      || source.includes('laugh') || source.includes('gasp') || source.includes('cry')
      || source.includes('sob') || source.includes('whimper');
  }) || /\b(?:voice|tone|shout|yell|scream|whisper|moan|gasp|sob|laugh)\b/i.test(text);
}

export function inferTtsDeliveryTagsDetailed(context = '', speech = '', options = {}) {
  const mode = normalizeTagMode(options.mode);
  const contextText = String(context || '').replace(/\s+/g, ' ').trim();
  const speechText = String(speech || '').replace(/\s+/g, ' ').trim();
  const haystack = `${contextText} ${speechText}`.trim();
  const maxPicked = Number.isFinite(options.maxTags) ? Math.max(1, Math.min(24, Math.floor(options.maxTags))) : 10;
  if (!haystack) return { tags: [], reasoning: [], confidence: 0 };

  const scored = [];
  for (const cue of TTS_DELIVERY_CUES) {
    let matches = 0;
    for (const pattern of cue.patterns) matches += countPatternMatches(haystack, pattern);
    if (!matches || (mode === 'conservative' && !cueHasStrongEvidence(cue, haystack))) continue;
    const score = cue.weight + Math.min(matches, 3) + (contextText ? 1 : 0);
    scored.push({ tag: cue.tag, category: cue.category, score, matches });
  }

  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  const reasoning = [];
  const categories = new Set();
  for (const item of scored) {
    if (picked.includes(item.tag)) continue;
    if (item.tag === 'laughing' && picked.includes('soft laugh')) continue;
    if (item.tag === 'gasp' && picked.includes('soft gasp')) continue;
    if (categories.has(item.category) && item.category !== 'nonverbal') continue;
    picked.push(item.tag);
    categories.add(item.category);
    reasoning.push({ tag: item.tag, confidence: Math.min(1, item.score / 10), evidence: item.matches });
    if (picked.length >= maxPicked) break;
  }
  return { tags: picked, reasoning, confidence: reasoning.length ? Math.max(...reasoning.map((x) => x.confidence)) : 0 };
}

export function inferTtsDeliveryTags(context = '', speech = '', options = {}) {
  return inferTtsDeliveryTagsDetailed(context, speech, options).tags;
}

function splitSpeechClauses(text) {
  return text.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((clause) => clause.trim()).filter(Boolean) || [];
}

function extractNarrationDirection(raw) {
  return [...String(raw || '').matchAll(/\*{1,2}([^*\r\n]{1,500})\*{1,2}|_{1,2}([^_\r\n]{1,500})_{1,2}/g)]
    .map((match) => match[1] || match[2])
    .map((value) => value.trim()).filter(Boolean).join(' ');
}

function inferClauseResults(rawText, options = {}) {
  const includeAsteriskNarration = options.includeAsteriskNarration === true;
  const speech = cleanTtsSpeechText(stripRpNarrationForTts(rawText, { includeAsteriskNarration }));
  const narration = includeAsteriskNarration ? '' : extractNarrationDirection(rawText);
  const mode = normalizeTagMode(options.mode);
  const maxTags = getTtsTagLimitForText(speech || rawText);
  return splitSpeechClauses(speech).map((clause) => {
    const hasExplicit = hasInlineFishEmotionTags(clause);
    const detail = hasExplicit
      ? { tags: parseTtsEmotionTags(clause), reasoning: [], confidence: 1 }
      : inferTtsDeliveryTagsDetailed(narration, clause, { maxTags, mode });
    return { clause, hasExplicit, ...detail };
  });
}

export function renderFishDirectedTtsText(rawText = '', options = {}) {
  const raw = String(rawText || '').trim();
  const includeAsteriskNarration = options.includeAsteriskNarration === true;
  const clauseResults = inferClauseResults(raw, options);
  const maxTags = getTtsTagLimitForText(raw);
  if (clauseResults.length) {
    const tags = capTtsEmotionTagRepeats(clauseResults.flatMap((result) => result.tags), 1, maxTags);
    const text = clauseResults.map(({ clause, tags: clauseTags, hasExplicit }) => {
      const tagText = hasExplicit ? '' : formatTtsEmotionTags(clauseTags, { maxTags });
      return cleanTtsSpeechText(`${tagText ? `${tagText} ` : ''}${clause}`);
    }).join(' ');
    return { text, tags, reasoning: clauseResults.flatMap((result) => result.reasoning || []), confidence: Math.max(0, ...clauseResults.map((result) => result.confidence || 0)) };
  }
  return { text: normalizeTtsText(raw), tags: [], reasoning: [], confidence: 0 };
}

export async function tagTtsText({ text, includeAsteriskNarration = false, mode = 'conservative' } = {}) {
  const rawText = String(text || '').trim();
  const spokenText = cleanTtsSpeechText(stripRpNarrationForTts(rawText, { includeAsteriskNarration }));
  const normalizedText = normalizeTtsText(spokenText || rawText);

  const textWithoutTags = stripInlineFishEmotionTags(normalizedText);
  if (hasInlineFishEmotionTags(normalizedText) && !textWithoutTags) {
    const error = new Error('Text must include speech in addition to emotion tags');
    error.statusCode = 400;
    throw error;
  }
  const directed = renderFishDirectedTtsText(rawText, { includeAsteriskNarration, mode });
  const taggedText = normalizeTtsText(directed.text || spokenText || rawText);
  const tags = capTtsEmotionTagRepeats([...parseTtsEmotionTags(taggedText)], 1, getTtsTagLimitForText(rawText));
  return {
    ok: true,
    input: rawText,
    taggedText,
    text: taggedText,
    tags,
    tag: formatTtsEmotionTags(tags, { maxTags: getTtsTagLimitForText(rawText) }),
    spokenText: cleanTtsSpeechText(stripInlineFishEmotionTags(taggedText)),
    confidence: directed.confidence,
    reasoning: directed.reasoning,
    mode: normalizeTagMode(mode)
  };
}
