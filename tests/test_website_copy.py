# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / 'landing-page' / 'src' / 'content'
DASH_IN_SENTENCE = re.compile(r'—| – ')


def copy(lang):
    return json.loads((CONTENT / f'i18n-{lang}.json').read_text(encoding='utf-8'))


def shape(value, path=''):
    if isinstance(value, dict):
        return {path + '{}'} | {item for key, inner in value.items() for item in shape(inner, f'{path}.{key}')}
    if isinstance(value, list):
        return {f'{path}[{len(value)}]'} | {item for index, inner in enumerate(value) for item in shape(inner, f'{path}[{index}]')}
    return {path}


def strings(value, path=''):
    if isinstance(value, dict):
        for key, inner in value.items():
            yield from strings(inner, f'{path}.{key}')
    elif isinstance(value, list):
        for index, inner in enumerate(value):
            yield from strings(inner, f'{path}[{index}]')
    elif isinstance(value, str):
        yield path, value


def test_both_languages_have_the_same_keys_and_list_lengths():
    german, english = shape(copy('de')), shape(copy('en'))
    assert german - english == set(), 'nur auf Deutsch'
    assert english - german == set(), 'nur auf Englisch'


def test_copy_has_no_dash_inside_a_sentence():
    found = [f'{lang}{path}: {text[:80]}' for lang in ('de', 'en') for path, text in strings(copy(lang)) if DASH_IN_SENTENCE.search(text)]
    assert not found, '\n'.join(found)

