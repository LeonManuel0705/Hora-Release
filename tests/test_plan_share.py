# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def node_at_least(major):
    node = shutil.which('node')
    if not node:
        pytest.skip('node is not installed')
    found = int(re.match(r'v(\d+)', subprocess.run([node, '--version'], capture_output=True, text=True).stdout).group(1))
    if found < major:
        pytest.skip('node is too old')
    return node


def test_a_shared_plan_carries_the_timetable_and_nothing_else():
    node = node_at_least(20)
    result = subprocess.run([node, str(ROOT / 'tests' / 'js' / 'plan_share_check.mjs')], capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr


def test_the_share_modules_parse_as_modules():
    node = node_at_least(20)
    for name in ('plan-share.js', 'plan-format.js', 'qrcodegen.js'):
        source = (ROOT / 'app' / 'static' / 'app' / 'js' / name).read_text(encoding='utf-8')
        result = subprocess.run([node, '--input-type=module', '--check'], input=source, capture_output=True, text=True, timeout=60)
        assert result.returncode == 0, name + result.stderr


def test_the_qr_encoder_keeps_its_licence_notice():
    source = (ROOT / 'app' / 'static' / 'app' / 'js' / 'qrcodegen.js').read_text(encoding='utf-8')
    assert 'Copyright (c) Project Nayuki. (MIT License)' in source
    assert 'The above copyright notice and this permission notice shall be included in' in source
