# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import re
import shutil
import subprocess
from pathlib import Path

import pytest

from app import database as db
from app import local_ai
from app import ui_data

ROOT = Path(__file__).resolve().parent.parent


def test_the_chat_helpers_work_without_turning_text_into_code():
    node = shutil.which('node')
    if not node:
        pytest.skip('node is not installed')
    major = int(re.match(r'v(\d+)', subprocess.run([node, '--version'], capture_output=True, text=True).stdout).group(1))
    if major < 18:
        pytest.skip('node is too old')
    result = subprocess.run([node, str(ROOT / 'tests' / 'js' / 'chat_check.mjs')], capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.fixture
def hub(tmp_path, monkeypatch):
    from app import app as hub_module
    from app import assistant_service as ai

    monkeypatch.setattr(db, 'DATABASE_PATH', str(tmp_path / 'hub.db'))
    db.init_db()
    monkeypatch.setattr(ui_data, 'refresh_weather_soon', lambda location: None)
    monkeypatch.setattr(ai, 'check_ollama_status', lambda: {'available': False, 'models': []})
    monkeypatch.setattr(ai, 'check_claude_status', lambda: {'available': False, 'reason': 'no_key'})
    monkeypatch.setattr(local_ai, 'MODELS_DIR', tmp_path / 'models')
    monkeypatch.setattr(local_ai, 'installer', local_ai.Installer())
    hub_module.app.config['TESTING'] = True
    with hub_module.app.test_client() as client:
        client.get(f'/hub?token={hub_module.API_TOKEN}')
        yield client


def test_the_chat_lives_in_the_new_interface_with_a_strict_policy(hub):
    response = hub.get('/hub/assistant?ohne-ki=1')
    html = response.get_data(as_text=True)
    assert 'data-page-module="chat"' in html and 'id="chatMessages"' in html
    assert 'data-variant="palette"' in html and 'hub-layout' not in html
    assert 'aria-current="page"' in html.split('id="navDrawer"')[1].split('</div>')[0]
    script_src = re.search(r"script-src ([^;]+)", response.headers['Content-Security-Policy']).group(1)
    assert "'unsafe-inline'" not in script_src and "'unsafe-eval'" not in script_src
    nonce = re.search(r"'nonce-([^']+)'", script_src).group(1)
    tags = re.findall(r"<[a-zA-Z][^>]*>", html)
    runnable = [tag for tag in tags if tag.startswith('<script') and 'type="application/json"' not in tag]
    assert runnable and all(f'nonce="{nonce}"' in tag for tag in runnable)
    assert not [tag for tag in tags if re.search(r"\son[a-z]+\s*=", tag)]
    for dialog in ('mathModal', 'essayModal', 'summaryModal'):
        assert f'id="{dialog}"' in html
    assert 'href="/hub/assistant?installieren=1"' in html


def test_the_chosen_basic_mode_can_be_taken_back_from_the_new_interface(hub):
    assert hub.put('/api/ui/store/app-assistant-basic', json=True).status_code == 200
    assert 'data-page-module="chat"' in hub.get('/hub/assistant').get_data(as_text=True)
    settings = hub.get('/hub/settings').get_data(as_text=True)
    store = re.search(r'<script type="application/json" id="appStore">(.*?)</script>', settings, re.S).group(1)
    assert '"app-assistant-basic":true' in store
    assert hub.delete('/api/ui/store/app-assistant-basic').status_code == 200
    assert 'data-page-module="assistant"' in hub.get('/hub/assistant').get_data(as_text=True)


def test_the_new_chat_scripts_never_build_code_from_text():
    for name in ('pages/chat.js', 'chat-math.js', 'chat-format.js'):
        script = (ROOT / 'app' / 'static' / 'app' / 'js' / name).read_text(encoding='utf-8')
        assert not re.search(r"\bFunction\(|\beval\(|onclick|\balert\(|\bconfirm\(", script), name


def test_the_classic_assistant_page_is_gone():
    assert not (ROOT / 'app' / 'templates' / 'hub' / 'assistant.html').exists()


def test_the_ported_copy_reads_like_the_rest_of_the_app():
    template = (ROOT / 'app' / 'templates' / 'app' / 'chat.html').read_text(encoding='utf-8')
    assert 'id="chatInput"' in template and 'maxlength' not in template.split('id="chatInput"')[1].split('>')[0]
    for name in ('pages/chat.js', 'chat-math.js'):
        script = (ROOT / 'app' / 'static' / 'app' / 'js' / name).read_text(encoding='utf-8')
        visible = re.findall(r'<(?:p|li|h4|strong)>([^<]*)', script)
        assert not [line for line in visible if re.search(r'[A-Za-zäöüÄÖÜ)] - [A-Za-zäöüÄÖÜ]', line)], name
        assert not re.search(r'//\s*(keep legacy|Create message|Process remaining)|/\*\s*ignore\s*\*/', script), name
