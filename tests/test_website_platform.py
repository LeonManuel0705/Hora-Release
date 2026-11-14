# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def test_website_offers_each_device_what_it_can_run():
    node = shutil.which('node')
    if not node:
        pytest.skip('node is not installed')
    major = int(re.match(r'v(\d+)', subprocess.run([node, '--version'], capture_output=True, text=True).stdout).group(1))
    if major < 18:
        pytest.skip('node is too old')
    result = subprocess.run([node, str(ROOT / 'tests' / 'js' / 'website_platform_check.mjs')], capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr


RELEASE_FILES = ('landing-page/public/version.json', 'landing-page/public/install-macos.sh', 'landing-page/src/js/lib/platform.js')


def test_no_placeholder_of_a_release_is_left_for_the_website():
    left = [f'{name}: {token}' for name in RELEASE_FILES for token in re.findall(r'TODO_[A-Z0-9_]+', (ROOT / name).read_text(encoding='utf-8'))]
    assert not left, 'Fill these in from the Mac build and the release build before publishing:\n' + '\n'.join(left)
