# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import hashlib
import http.server
import importlib.util
import json
import re
import shutil
import subprocess
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fake_build(folder, files):
    for name, text in files.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
    shutil.copy(ROOT / 'flutter_app' / 'web' / 'app_worker.js', folder / 'app_worker.js')


def manifest_of(folder):
    source = (folder / 'app_worker.js').read_text(encoding='utf-8')
    return json.loads(re.search(r'^const MANIFEST = (.*);$', source, re.M).group(1))


def run_check(name):
    node = shutil.which('node')
    if not node:
        pytest.skip('node is not installed')
    major = int(re.match(r'v(\d+)', subprocess.run([node, '--version'], capture_output=True, text=True).stdout).group(1))
    if major < 20:
        pytest.skip('node is too old')
    result = subprocess.run([node, str(ROOT / 'tests' / 'js' / name)], capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr


def test_the_offline_worker_serves_every_tab_the_build_it_started_with():
    run_check('app_worker_check.mjs')


def test_a_backup_reaches_the_files_app_on_iphone_and_the_downloads_elsewhere():
    run_check('offer_file_check.mjs')


def test_the_file_list_holds_what_the_app_loads_and_leaves_out_the_rest(tmp_path):
    build = script('build_web_app')
    kept = {
        'index.html': '<html></html>',
        'main.dart.js': 'main',
        'flutter_bootstrap.js': 'boot',
        'sqlite3-3.3.4.wasm': 'sqlite',
        'assets/assets/ui/pages/tasks.html': 'tasks',
        'assets/assets/ui/static/app/js/settings.js': 'settings',
        'canvaskit/canvaskit.js': 'canvaskit',
        'canvaskit/canvaskit.wasm': 'wasm',
    }
    left_out = {
        'canvaskit/canvaskit.js.symbols': 'symbols',
        'canvaskit/chromium/canvaskit.wasm': 'chromium',
        'canvaskit/skwasm.wasm': 'skwasm',
        'canvaskit/skwasm_heavy.js': 'heavy',
        'flutter_service_worker.js': 'old worker',
        'hub_worker.js': 'hub',
        '.last_build_id': 'id',
    }
    fake_build(tmp_path, {**kept, **left_out})
    first = build.stamp(tmp_path)
    manifest = manifest_of(tmp_path)
    assert manifest['build'] == first
    assert set(manifest['files']) == set(kept)
    assert manifest['files']['main.dart.js'] == hashlib.sha256(b'main').hexdigest()
    assert build.stamp(tmp_path) == first
    (tmp_path / 'main.dart.js').write_text('changed', encoding='utf-8')
    assert build.stamp(tmp_path) != first
    written = (tmp_path / 'app_worker.js').read_bytes()
    assert written.count(b'const MANIFEST = ') == 1
    assert b'\r\n' not in written


@pytest.fixture()
def local_host(tmp_path):
    serve = script('serve_web_app')
    fake_build(tmp_path, {'index.html': '<!doctype html><html><head><meta charset="utf-8"><title>x</title></head></html>', 'sqlite.wasm': 'wasm', 'hub_worker.js': 'hub'})
    serve.Handler.build = tmp_path.resolve()
    serve.Handler.rules = serve.header_rules(ROOT / 'landing-page' / 'public' / '_headers')
    serve.Handler.log_message = lambda *args: None
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), serve.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{server.server_address[1]}'
    server.shutdown()
    server.server_close()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch(url, headers=None):
    opener = urllib.request.build_opener(NoRedirect)
    try:
        response = opener.open(urllib.request.Request(url, headers=headers or {}), timeout=10)
    except urllib.error.HTTPError as error:
        return error.code, error.headers, b''
    return response.status, response.headers, response.read()


def test_the_local_host_answers_like_the_website_host(local_host):
    status, headers, _ = fetch(f'{local_host}/pwa')
    assert (status, headers['Location']) == (301, '/pwa/')
    status, headers, body = fetch(f'{local_host}/pwa/')
    assert status == 200
    rules = (ROOT / 'landing-page' / 'public' / '_headers').read_text(encoding='utf-8')
    app_rules = rules[rules.index('/pwa/*\n'):]
    assert headers['Content-Security-Policy'] == re.search(r'Content-Security-Policy: (.*)', app_rules).group(1).strip()
    assert headers['X-Frame-Options'] == 'DENY'
    assert headers['Cache-Control'] == 'public,max-age=0,must-revalidate'
    assert body.startswith(b'<!doctype html><html><head><meta charset="utf-8">\n<!-- injected')
    assert fetch(f'{local_host}/pwa/', {'If-None-Match': headers['ETag']})[0] == 304
    assert fetch(f'{local_host}/pwa/sqlite.wasm')[1]['Content-Type'] == 'application/wasm'
    assert fetch(f'{local_host}/pwa/hub_worker.js')[1]['Service-Worker-Allowed'] == '/hub'
    assert fetch(f'{local_host}/pwa/../tests/test_web_app.py')[0] == 404
    assert fetch(f'{local_host}/elsewhere')[0] == 404
