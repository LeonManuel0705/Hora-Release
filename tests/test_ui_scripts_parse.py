# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = sorted((ROOT / 'app' / 'static' / 'app' / 'js').rglob('*.js'))


def node():
    found = shutil.which('node')
    if not found:
        pytest.skip('node is not installed')
    major = int(re.match(r'v(\d+)', subprocess.run([found, '--version'], capture_output=True, text=True).stdout).group(1))
    if major < 18:
        pytest.skip('node is too old')
    return found


@pytest.mark.parametrize('script', SCRIPTS, ids=lambda path: path.relative_to(ROOT).as_posix())
def test_every_page_script_parses_as_a_module(script):
    # As a module file, as the pages load it. A file checked by name can be read as a plain script, which lets a
    # name declared twice in a function pass, while the browser refuses the whole file and the page stays empty.
    result = subprocess.run([node(), '--input-type=module', '--check'], input=script.read_text(encoding='utf-8'), capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
