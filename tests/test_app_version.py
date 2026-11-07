# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RENDER = """
import re
from app import app as module
from app.app import app
app.config['TESTING'] = True
with app.test_client() as client:
    client.get(f'/hub?token={module.API_TOKEN}')
    page = client.get('/hub').get_data(as_text=True)
    about = client.get('/hub/settings').get_data(as_text=True)
print('VERSION=' + re.search(r'data-app-version="([^"]*)"', page).group(1))
print('ABOUT=' + re.search(r'id="aboutCard" data-version="([^"]*)"', about).group(1))
"""


def render_from_copy(tmp_path, **variables):
    backend = tmp_path / 'backend'
    if not backend.exists():
        shutil.copytree(ROOT / 'app', backend / 'app', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    environment = {key: value for key, value in os.environ.items() if not key.endswith(('_APP_VERSION', '_APP_BUILD'))}
    environment.update({'HUB_DATA_DIR': str(tmp_path / 'data'), 'SECRET_KEY': 'version-check-0123456789abcdef0123456789abcdef', 'PYTHONPATH': ''})
    environment.update(variables)
    result = subprocess.run([sys.executable, '-c', RENDER], cwd=backend, env=environment, capture_output=True, text=True, timeout=180)
    assert result.returncode == 0, result.stdout + result.stderr
    lines = dict(line.split('=', 1) for line in result.stdout.splitlines() if line.startswith(('VERSION=', 'ABOUT=')))
    return lines['VERSION'], lines['ABOUT']


def test_an_installed_copy_without_flutter_app_shows_what_its_shell_hands_over(tmp_path):
    assert not (tmp_path / 'backend' / 'flutter_app').exists()
    version, about = render_from_copy(tmp_path, HUB_APP_VERSION='0.5.2 Closed Beta', HUB_APP_BUILD='40')
    assert version == about == '0.5.2 Closed Beta (Build 40)'


def test_an_installed_copy_without_any_hint_shows_no_made_up_version(tmp_path):
    version, about = render_from_copy(tmp_path)
    assert version == about == ''


def test_the_checkout_still_reads_its_build_file(monkeypatch):
    from app import app as app_module

    for name in ('HUB_APP_VERSION', 'HUB_APP_BUILD', 'NEXUS_APP_VERSION', 'NEXUS_APP_BUILD'):
        monkeypatch.delenv(name, raising=False)
    content = (ROOT / 'flutter_app' / 'lib' / 'build_info.dart').read_text(encoding='utf-8')
    assert app_module._read_build_info().endswith(f"(Build {content.split('buildNumber = ')[1].split(';')[0]})")
    monkeypatch.setenv('HUB_APP_VERSION', '0.6.0 Beta')
    monkeypatch.setenv('HUB_APP_BUILD', 'x')
    assert app_module._get_app_version() == '0.6.0 Beta'
