import { normalizeTtsText, parseTtsEmotionTags, tagTtsText } from './tagging.js';

export const DRAMA3_BACKEND = 'drama-3-preview';

const DIRECTIONS = {
  whisper: 'Speak in a close, soft whisper.',
  'quiet voice': 'Keep the voice quiet and intimate.',
  'soft gentle tone': 'Speak gently and warmly.',
  sigh: 'Let out a quiet sigh before speaking.',
  'soft laugh': 'Give a small, soft laugh before speaking.',
  chuckle: 'Chuckle lightly before the line.',
  laughing: 'Speak with audible laughter.',
  'soft gasp': 'Take a small, surprised breath.',
  gasp: 'Gasp before the line.',
  whimper: 'Let the voice tremble into a whimper.',
  'loud moan': 'Let out a strong, audible moan.',
  'soft moan': 'Let out a quiet, breathy moan.',
  breathless: 'Speak breathlessly, with short breaths.',
  'shaky voice': 'Let the voice shake and nearly break.',
  'sad soft voice': 'Speak softly with sadness.',
  crying: 'Speak through tears.',
  'nervous hesitant voice': 'Speak with nervous hesitation.',
  'shy soft voice': 'Speak shyly and softly.',
  'sharp irritated tone': 'Speak sharply with irritation.',
  'stern serious tone': 'Speak firmly and seriously.',
  deadpan: 'Speak flatly and without visible emotion.',
  'teasing amused tone': 'Speak playfully with amused teasing.',
  sarcastic: 'Speak with dry sarcasm.',
  'excited bright voice': 'Speak brightly with excitement.',
  surprised: 'Sound genuinely surprised.',
  'calm steady tone': 'Settle into a calm, steady voice.',
  'commanding voice': 'Speak with clear authority.',
  loud: 'Project the voice loudly.',
  screaming: 'Scream the line with urgency.',
  happy: 'Sound happy.',
  sad: 'Sound sad.',
  angry: 'Sound angry.',
  fearful: 'Sound fearful.',
  disgusted: 'Sound disgusted.',
  calm: 'Sound calm.',
  serious: 'Sound serious.',
  excited: 'Sound excited.',
  nervous: 'Sound nervous.',
  shout: 'Shout the line.'
};

function normalizeDirection(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 300 || /[\[\]<>]/.test(value)) {
    const error = new Error('direction must be plain language of at most 300 characters');
    error.statusCode = 400;
    throw error;
  }
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const sentence = /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
  return isProseDirection(sentence) ? sentence : `Direction: ${sentence}`;
}

function isProseDirection(value) {
  return /^(?:Direction:\s+|(?:Speak|Give|Let|Take|Gasp|Chuckle|Scream|Sound|Project|Keep|Settle|Deliver|Start|Open|Play|Use|Pause)\b)/i.test(value)
    && /[.!?]$/.test(value);
}

function protectDirections(text) {
  const saved = [];
  const protectedText = String(text || '').replace(/\[([^\]\r\n]{1,320})\]/g, (match, content) => {
    if (!isProseDirection(content)) return match;
    const placeholder = `[DRAMADIRECTIONPLACEHOLDER${saved.length}]`;
    saved.push({ placeholder, original: match });
    return placeholder;
  });
  return { protectedText, saved };
}

export async function tagDrama3Text({ text, includeAsteriskNarration = false, mode = 'conservative', direction } = {}) {
  const { protectedText, saved } = protectDirections(text);
  const legacy = await tagTtsText({ text: protectedText, includeAsteriskNarration, mode });
  const userDirection = normalizeDirection(direction);
  let rendered = legacy.taggedText.replace(/\[([a-z][a-z\s-]{1,40})\]/gi, (match, label) => {
    if (!parseTtsEmotionTags(match).length) return match;
    const prose = DIRECTIONS[label.toLowerCase().replace(/\s+/g, ' ').trim()]
      || `Deliver this line with ${label.toLowerCase()} expression.`;
    return `[${prose}]`;
  });
  for (const { placeholder, original } of saved) rendered = rendered.replace(placeholder, original);
  if (userDirection) {
    rendered = `[${userDirection}] ${rendered}`;
  }
  // Fish speaker markers must precede the direction for that speaker.
  rendered = rendered.replace(/^((?:\[[^\]]+\]\s*)+)(<\|speaker:\d+\|>)/, '$2$1');
  const taggedText = normalizeTtsText(rendered);
  const directions = [...taggedText.matchAll(/\[([^\]\r\n]{1,320})\]/g)]
    .map((match) => match[1]).filter(isProseDirection);
  const spokenText = taggedText.replace(/\[([^\]\r\n]{1,320})\]/g, (match, content) =>
    isProseDirection(content) ? ' ' : match)
    .replace(/<\|speaker:\d+\|>/g, '').replace(/\s+/g, ' ').trim();
  if (!spokenText) {
    const error = new Error('Text must include speech in addition to directions');
    error.statusCode = 400;
    throw error;
  }
  return {
    ...legacy,
    input: String(text || '').trim(),
    taggedText,
    text: taggedText,
    tag: directions.map((prose) => `[${prose}]`).join(' '),
    spokenText,
    directions,
    tagger: 'drama3'
  };
}
