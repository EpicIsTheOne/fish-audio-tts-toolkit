import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import urljoin

import requests
from dotenv import load_dotenv
from playsound3 import playsound

load_dotenv()

HELPER_URL = os.getenv('FISH_HELPER_URL', 'http://127.0.0.1:3027/')
VOICE_ID = os.getenv('FISH_VOICE_ID', '').strip()
FORMAT = os.getenv('FISH_FORMAT', 'mp3').strip() or 'mp3'
LATENCY = os.getenv('FISH_LATENCY', 'low').strip() or 'low'
INCLUDE_ASTERISK_NARRATION = os.getenv('FISH_INCLUDE_ASTERISK_NARRATION', 'false').lower() == 'true'


def post_json(path: str, payload: dict, expect_json: bool = True):
    response = requests.post(urljoin(HELPER_URL, path.lstrip('/')), json=payload, timeout=120)
    response.raise_for_status()
    return response.json() if expect_json else response


def auto_tag_and_play(text: str, voice_id: str):
    if not voice_id:
        raise RuntimeError('Set FISH_VOICE_ID in your environment or pass it explicitly in code.')

    tag_result = post_json('/api/tts/tag', {
        'text': text,
        'includeAsteriskNarration': INCLUDE_ASTERISK_NARRATION,
    })

    audio_response = requests.post(
        urljoin(HELPER_URL, '/api/tts/audio'),
        json={
            'text': text,
            'voiceId': voice_id,
            'format': FORMAT,
            'latency': LATENCY,
            'includeAsteriskNarration': INCLUDE_ASTERISK_NARRATION,
            'stream': False,
        },
        timeout=240,
    )
    audio_response.raise_for_status()

    suffix = '.mp3' if FORMAT == 'mp3' else f'.{FORMAT}'
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(audio_response.content)
        tmp_path = Path(tmp.name)

    try:
        print('Input text:     ', text)
        print('Spoken text:    ', tag_result.get('spokenText'))
        print('Auto tags:      ', tag_result.get('tags'))
        print('Tagged text:    ', tag_result.get('taggedText'))
        print('Temporary audio:', tmp_path)
        print('Playing now...')
        playsound(str(tmp_path))
    finally:
        tmp_path.unlink(missing_ok=True)


if __name__ == '__main__':
    sample_text = ' '.join(sys.argv[1:]).strip() or '*she laughs softly* "You really thought that would work? Cute."'
    auto_tag_and_play(sample_text, VOICE_ID)
