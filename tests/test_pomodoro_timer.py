# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: AGPL-3.0-only

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / 'app' / 'static' / 'app' / 'js'


def test_every_page_runs_the_timer_watcher():
    main = (SCRIPTS / 'main.js').read_text(encoding='utf-8')
    assert 'import { initPomodoro } from "./pomodoro-timer.js";' in main
    assert re.search(r'^initPomodoro\(\);$', main, re.M)


def test_the_end_notice_goes_through_the_reminders():
    source = (SCRIPTS / 'reminders.js').read_text(encoding='utf-8')
    assert 'prefs.categories.pomodoro.on' in source
    assert 'subscribe(' in source and 'tag: reminder.key' in source
    assert 'url = "/hub/pomodoro"' in source


def test_the_timer_does_not_touch_the_page_when_it_is_loaded():
    source = (SCRIPTS / 'pomodoro-timer.js').read_text(encoding='utf-8')
    assert not re.search(r'^import ', source, re.M)


def test_timer_logic_holds_up_under_node():
    node = shutil.which('node')
    if not node:
        pytest.skip('node is not installed')
    major = int(re.match(r'v(\d+)', subprocess.run([node, '--version'], capture_output=True, text=True).stdout).group(1))
    if major < 18:
        pytest.skip('node is too old')
    result = subprocess.run([node, str(ROOT / 'tests' / 'js' / 'pomodoro_timer_check.mjs')], capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr
