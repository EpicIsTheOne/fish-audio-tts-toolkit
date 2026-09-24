import test from 'node:test';
import assert from 'node:assert/strict';
import { tagDrama3Text } from '../src/drama3.js';

test('Drama 3 renders ordinary delivery cues as plain-language directions', async () => {
  const result = await tagDrama3Text({ text: '*she whispers* "Hello." *she shouts* "Run!"' });
  assert.equal(result.taggedText, '[Speak in a close, soft whisper.] Hello. [Project the voice loudly.] Run!');
  assert.equal(result.spokenText, 'Hello. Run!');
  assert.deepEqual(result.directions, ['Speak in a close, soft whisper.', 'Project the voice loudly.']);
  assert.equal(result.tag, '[Speak in a close, soft whisper.] [Project the voice loudly.]');
});

test('Drama 3 keeps speaker markers before each speaker direction', async () => {
  const result = await tagDrama3Text({
    text: '<|speaker:0|>Hello. <|speaker:1|>[whisper] Stay close.',
    direction: 'Open with a calm tone.'
  });
  assert.equal(result.taggedText,
    '<|speaker:0|>[Open with a calm tone.] Hello. <|speaker:1|>[Speak in a close, soft whisper.] Stay close.');
  assert.equal(result.spokenText, 'Hello. Stay close.');
});

test('Drama 3 rejects malformed custom directions', async () => {
  await assert.rejects(() => tagDrama3Text({ text: 'Hello.', direction: '[whisper]' }),
    { statusCode: 400 });
});

test('Drama 3 preview text can be reused without duplicate directions', async () => {
  const first = await tagDrama3Text({ text: '*she whispers* "Come closer."' });
  const second = await tagDrama3Text({ text: first.taggedText });
  assert.equal(second.taggedText, first.taggedText);
  assert.equal(second.spokenText, 'Come closer.');
  assert.deepEqual(second.directions, ['Speak in a close, soft whisper.']);
});

test('free-form directions without punctuation remain reusable', async () => {
  const first = await tagDrama3Text({ text: 'Hello.', direction: 'whisper gently' });
  assert.equal(first.taggedText, '[Direction: whisper gently.] Hello.');
  assert.equal((await tagDrama3Text({ text: first.taggedText })).taggedText, first.taggedText);
});

test('Drama 3 rejects direction-only text', async () => {
  await assert.rejects(() => tagDrama3Text({ text: '[Speak in a close, soft whisper.]' }),
    { statusCode: 400 });
});
