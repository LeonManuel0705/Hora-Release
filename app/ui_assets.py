# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import hashlib
from pathlib import Path

STATIC_ROOT = Path(__file__).resolve().parent / 'static'

UI_STATIC = [
    'app',
    'fonts/plus-jakarta-sans.woff2',
    'fonts/OFL-PlusJakartaSans.txt',
    'css/tour.css',
    'js/luna.js',
    'js/tour.js',
]


def ui_static_files():
    for entry in UI_STATIC:
        origin = STATIC_ROOT / entry
        if origin.is_dir():
            yield from sorted(path for path in origin.rglob('*') if path.is_file() and not path.name.startswith('.'))
        else:
            yield origin


def asset_digest():
    digest = hashlib.sha1()
    for path in ui_static_files():
        digest.update(path.relative_to(STATIC_ROOT).as_posix().encode('utf-8'))
        digest.update(path.read_bytes())
    return digest.hexdigest()[:10]


def asset_urls():
    return [f"/static/{path.relative_to(STATIC_ROOT).as_posix()}" for path in ui_static_files()]
