export function normalizeVoiceSearchText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenizeVoiceSearchText(value = '') {
  return normalizeVoiceSearchText(value).split(/\s+/).filter(Boolean);
}

export function dedupeModelsById(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const id = String(item?._id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function inferCharacterVoiceHints(character = null) {
  const rawText = [
    character?.name,
    character?.description,
    character?.personality,
    character?.scenario,
    ...(Array.isArray(character?.tags) ? character.tags : [])
  ].filter(Boolean).join(' ');

  const text = normalizeVoiceSearchText(rawText);
  const tagHints = new Set(tokenizeVoiceSearchText(Array.isArray(character?.tags) ? character.tags.join(' ') : ''));
  const genders = new Set();
  const languages = new Set();

  if (/\b(she|her|hers|woman|female|girl|princess|lady|mother|sister|wife)\b/.test(text)) genders.add('female');
  if (/\b(he|him|his|man|male|boy|prince|gentleman|father|brother|husband)\b/.test(text)) genders.add('male');

  const languageMatchers = [
    ['english', /\b(english|british|american|australian|canadian)\b/],
    ['japanese', /\b(japanese|japan)\b/],
    ['korean', /\b(korean|korea)\b/],
    ['chinese', /\b(chinese|mandarin|cantonese|china)\b/],
    ['spanish', /\b(spanish|espanol|latina|latino|mexican)\b/],
    ['french', /\b(french|france)\b/],
    ['german', /\b(german|germany)\b/],
    ['russian', /\b(russian|russia)\b/],
    ['portuguese', /\b(portuguese|brazilian|brazil)\b/]
  ];

  for (const [language, regex] of languageMatchers) if (regex.test(text)) languages.add(language);
  if (/\b(anime|vtuber|idol|fantasy|elf|princess|prince)\b/.test(text)) tagHints.add('anime');
  if (/\b(child|young|little girl|little boy|teen)\b/.test(text)) tagHints.add('young');

  return { genders: [...genders], languages: [...languages], tags: [...tagHints] };
}

export function buildFishMatchDetails(query, model, hints = null) {
  const normalizedQuery = normalizeVoiceSearchText(query);
  const normalizedTitle = normalizeVoiceSearchText(model?.title || '');
  const queryTokens = tokenizeVoiceSearchText(normalizedQuery);
  const titleTokens = tokenizeVoiceSearchText(normalizedTitle);
  const modelTags = tokenizeVoiceSearchText(Array.isArray(model?.tags) ? model.tags.join(' ') : '');
  const modelLanguages = tokenizeVoiceSearchText(Array.isArray(model?.languages) ? model.languages.join(' ') : '');
  let score = 0;
  const reasons = [];

  if (normalizedTitle === normalizedQuery) { score += 1000; reasons.push('exact name match'); }
  if (normalizedTitle.startsWith(normalizedQuery)) { score += 220; reasons.push('starts with query'); }
  if (normalizedTitle.includes(normalizedQuery)) { score += 170; reasons.push('contains query'); }
  if (normalizedQuery.startsWith(normalizedTitle)) score += 120;

  const sharedTokens = queryTokens.filter((token) => titleTokens.includes(token));
  score += sharedTokens.length * 45;
  if (sharedTokens.length) reasons.push(`shared tokens: ${sharedTokens.slice(0, 3).join(', ')}`);

  if (queryTokens[0] && titleTokens[0] === queryTokens[0]) score += 35;
  score -= Math.max(0, titleTokens.length - queryTokens.length) * 4;
  score += Math.min(Number(model?.task_count || 0), 1000) / 50;
  score += Math.min(Number(model?.like_count || 0), 500) / 80;
  if (model?.state === 'trained') score += 12;
  if (model?.visibility === 'public') score += 8;

  if (hints) {
    const hintLanguages = tokenizeVoiceSearchText(Array.isArray(hints.languages) ? hints.languages.join(' ') : '');
    const hintTags = tokenizeVoiceSearchText(Array.isArray(hints.tags) ? hints.tags.join(' ') : '');
    const hintGenders = tokenizeVoiceSearchText(Array.isArray(hints.genders) ? hints.genders.join(' ') : '');

    const languageHits = hintLanguages.filter((token) => modelLanguages.includes(token));
    const tagHits = hintTags.filter((token) => modelTags.includes(token));
    const genderHits = hintGenders.filter((token) => modelTags.includes(token) || titleTokens.includes(token));

    score += languageHits.length * 38;
    score += tagHits.length * 18;
    score += genderHits.length * 32;

    if (languageHits.length) reasons.push(`language fit: ${languageHits.join(', ')}`);
    if (genderHits.length) reasons.push(`gender vibe: ${genderHits.join(', ')}`);
    if (tagHits.length) reasons.push(`tag fit: ${tagHits.slice(0, 3).join(', ')}`);
  }

  return { score, reasons };
}

export async function fetchFishModels({ apiKey, baseUrl, cache, ttlMs = 300000, params = {} }) {
  const searchParams = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(params || {})) {
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) searchParams.append(key, String(value));
      continue;
    }
    searchParams.set(key, String(rawValue));
  }

  const cacheKey = searchParams.toString();
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.at) < ttlMs) return cached.value;

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/model?${searchParams.toString()}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(detail || `Fish model lookup failed (${response.status})`);
    error.statusCode = response.status === 401 || response.status === 402 ? 502 : 503;
    throw error;
  }

  const json = await response.json().catch(() => ({}));
  const value = { total: Number(json?.total || 0), items: Array.isArray(json?.items) ? json.items : [], has_more: Boolean(json?.has_more) };
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

export async function searchFishModelsByName(query, { apiKey, baseUrl, cache, ttlMs = 300000, limit = 8, pageSize = 12, character = null, hints = null } = {}) {
  const normalizedQuery = normalizeVoiceSearchText(query);
  if (!normalizedQuery) return { query, items: [], bestMatch: null };

  const resolvedHints = character ? inferCharacterVoiceHints(character) : inferCharacterVoiceHints(hints || null);
  const tokens = tokenizeVoiceSearchText(normalizedQuery);
  const lookups = [{ title: normalizedQuery, page_size: pageSize, sort_by: 'score' }];
  if (tokens.length > 1) lookups.push({ title: tokens[0], page_size: pageSize, sort_by: 'score' });
  if (tokens.length > 1) lookups.push({ title: tokens.slice(0, 2).join(' '), page_size: pageSize, sort_by: 'score' });

  const batches = [];
  for (const lookup of lookups) {
    try {
      const batch = await fetchFishModels({ apiKey, baseUrl, cache, ttlMs, params: lookup });
      batches.push(...batch.items);
    } catch (error) {
      if (!batches.length) throw error;
    }
  }

  let items = dedupeModelsById(batches)
    .filter((item) => item?.state === 'trained' && item?.dmca_taken_down !== true && item?.visibility !== 'private')
    .map((item) => {
      const details = buildFishMatchDetails(normalizedQuery, item, resolvedHints);
      return { ...item, _matchScore: details.score, matchReasons: details.reasons };
    })
    .filter((item) => Number.isFinite(item._matchScore) && item._matchScore > -100)
    .sort((a, b) => (b._matchScore - a._matchScore) || Number(b?.task_count || 0) - Number(a?.task_count || 0));

  if (!items.length) {
    const fallback = await fetchFishModels({ apiKey, baseUrl, cache, ttlMs, params: { page_size: pageSize, sort_by: 'score' } }).catch(() => ({ items: [] }));
    items = dedupeModelsById(fallback.items)
      .filter((item) => item?.state === 'trained' && item?.dmca_taken_down !== true && item?.visibility !== 'private')
      .map((item) => {
        const details = buildFishMatchDetails(normalizedQuery, item, resolvedHints);
        return { ...item, _matchScore: details.score, matchReasons: details.reasons };
      })
      .sort((a, b) => (b._matchScore - a._matchScore) || Number(b?.task_count || 0) - Number(a?.task_count || 0));
  }

  const trimmed = items.slice(0, Math.max(1, Number(limit || 8)));
  return { query, hints: resolvedHints, items: trimmed.map(({ _matchScore, ...item }) => item), bestMatch: trimmed[0] || null };
}
