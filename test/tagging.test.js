import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTtsMoans, stripRpNarrationForTts, tagTtsText } from '../src/tagging.js';

test('explicit Fish tags remain in synthesis text', async () => {
  const result = await tagTtsText({ text: '[whisper] come here' });
  assert.equal(result.taggedText, '[whisper] come here');
  assert.equal(result.spokenText, 'come here');
  assert.deepEqual(result.tags, ['whisper']);
});

test('explicit tags retain position, count, and punctuation boundaries', async () => {
  assert.equal((await tagTtsText({ text: '[whisper] hello [loud] world' })).taggedText, '[whisper] hello [loud] world');
  assert.equal((await tagTtsText({ text: '[screaming] Run!' })).taggedText, '[screaming] Run!');
  const punctuated = await tagTtsText({ text: '[whisper], come here' });
  assert.equal(punctuated.taggedText, '[whisper], come here');
  assert.equal(punctuated.spokenText, 'come here');
});

test('ordinary brackets and parentheses are not interpreted as Fish tags', async () => {
  const parenthetical = await tagTtsText({ text: 'Call me (maybe tomorrow) after lunch.' });
  const bracketed = await tagTtsText({ text: 'Use [square brackets] in the example.' });
  assert.equal(parenthetical.taggedText, 'Call me (maybe tomorrow) after lunch.');
  assert.equal(bracketed.taggedText, 'Use [square brackets] in the example.');
  assert.deepEqual(parenthetical.tags, []);
  assert.deepEqual(bracketed.tags, []);
});

test('ordinary words are never normalized as vocalizations', () => {
  assert.equal(normalizeTtsMoans('The human among us saw the moon.'), 'The human among us saw the moon.');
  assert.equal(normalizeTtsMoans('Ahhhhh... mmmm! nghhh'), 'Aaaah! Mmm Ngh');
  for (const text of ['human among moon', 'Ahhhhh... mmmm! nghhh', 'ordinary spoken language']) {
    assert.equal(normalizeTtsMoans(normalizeTtsMoans(text)), normalizeTtsMoans(text));
  }
});

test('negated delivery cues do not produce opposite tags', async () => {
  for (const text of ['I am not angry, just tired.', 'Do not whisper this sentence.', 'She spoke without laughing.']) {
    assert.deepEqual((await tagTtsText({ text })).tags, []);
  }
  assert.deepEqual((await tagTtsText({ text: 'I am not angry, but whisper this.' })).tags, ['whisper']);
});

test('delivery changes are tagged per clause', async () => {
  const result = await tagTtsText({ text: 'First she whispers. Then she screams.' });
  assert.match(result.taggedText, /^\[whisper\] First she whispers\./);
  assert.match(result.taggedText, /\[screaming\].*Then she screams\.$/);
  assert.deepEqual(result.tags, ['whisper', 'screaming']);
});

test('manual tags stay locked while later clauses are inferred', async () => {
  const result = await tagTtsText({ text: '[whisper] Come here. Then she screams. "Run!"' });
  assert.match(result.taggedText, /^\[whisper\] Come here\./);
  assert.match(result.taggedText, /\[screaming\] Then she screams\./);
  assert.match(result.taggedText, /\[screaming\] Then she screams\. Run!$/);
  assert.deepEqual(result.tags, ['whisper', 'screaming']);
});

test('narration direction informs speech without being spoken', async () => {
  const result = await tagTtsText({ text: '*she whispers softly* "Come closer."' });
  assert.equal(result.spokenText, 'Come closer.');
  assert.equal(result.taggedText, '[whisper] Come closer.');
});

test('conservative mode suppresses weak ambiguous cues while expressive can use them', async () => {
  const conservative = await tagTtsText({ text: 'The room has a soft blue light.' });
  const expressive = await tagTtsText({ text: 'The room has a soft blue light.', mode: 'expressive' });
  assert.deepEqual(conservative.tags, []);
  assert.deepEqual(expressive.tags, ['soft gentle tone']);
});

test('inferred intensity is bounded and output remains idempotent', async () => {
  const first = await tagTtsText({ text: 'She screams and screams and screams!' });
  assert.equal(first.taggedText, '[screaming] She screams and screams and screams!');
  const second = await tagTtsText({ text: first.taggedText });
  assert.equal(second.taggedText, first.taggedText);
});

test('tagging normalized output is idempotent', async () => {
  for (const text of ['*she laughs softly* "Hello."', '[whisper] hello [loud] world', 'Ordinary speech.']) {
    const first = await tagTtsText({ text });
    const second = await tagTtsText({ text: first.taggedText });
    assert.equal(second.taggedText, first.taggedText);
  }
});

test('emotion tags without speech are rejected', async () => {
  await assert.rejects(() => tagTtsText({ text: '[whisper]' }), { message: /must include speech/, statusCode: 400 });
});

test('RP cleanup removes actions without deleting emphasized speech', () => {
  assert.equal(stripRpNarrationForTts('*she laughs softly* "Hello."'), 'Hello.');
  assert.equal(stripRpNarrationForTts('This is **important** text.'), 'This is important text.');
  assert.equal(stripRpNarrationForTts('This is _important_ text.'), 'This is important text.');
  assert.equal(stripRpNarrationForTts('Use _snake_case_ in this sentence.'), 'Use _snake_case_ in this sentence.');
});
