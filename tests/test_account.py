# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from app import account_service
from app import database as db
from app import ui_data

ROOT = Path(__file__).resolve().parent.parent
ACCOUNT = {"service": "http://127.0.0.1:8794", "token": "t" * 43, "account": {"id": "acc-1", "email": "lina@example.org"}, "known": True}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATABASE_PATH", str(tmp_path / "hub.db"))
    monkeypatch.delenv(account_service.ENV_NAME, raising=False)
    db.init_db()
    monkeypatch.setattr(ui_data, "refresh_weather_soon", lambda location: None)
    from app import app as app_module
    from app.app import app

    app.config["TESTING"] = True
    with app.test_client() as client:
        client.get(f"/hub?token={app_module.API_TOKEN}")
        yield client


def page_json(client, name, path="/hub/settings"):
    html = client.get(path).get_data(as_text=True)
    return json.loads(re.search(rf'<script type="application/json" id="{name}">(.*?)</script>', html, re.S).group(1))


def connect_src(response):
    return re.search(r"connect-src ([^;]+)", response.headers["Content-Security-Policy"]).group(1).split()


def run_node(name):
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    major = int(re.match(r"v(\d+)", subprocess.run([node, "--version"], capture_output=True, text=True).stdout).group(1))
    if major < 22:
        pytest.skip("node is too old")
    return subprocess.run([node, str(ROOT / "tests" / "js" / name)], capture_output=True, text=True, timeout=300)


def test_the_account_core_keeps_its_rules_under_node():
    result = run_node("account_check.mjs")
    assert result.returncode == 0, result.stdout + result.stderr


def test_the_account_client_works_with_the_real_account_service_when_one_runs():
    result = run_node("account_service_check.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    if result.stdout.startswith("skip:"):
        pytest.skip(result.stdout.strip())


@pytest.mark.parametrize("value, origin", [
    ("http://127.0.0.1:8794", "http://127.0.0.1:8794"),
    ("https://konto.example.org/", "https://konto.example.org"),
    ("  https://konto.example.org:443  ", "https://konto.example.org"),
    ("http://[::1]:8794", "http://[::1]:8794"),
    ("", None),
    ("konto.example.org", None),
    ("ftp://konto.example.org", None),
    ("https://konto.example.org/api", None),
    ("https://user:secret@konto.example.org", None),
    ("https://konto.example.org?x=1", None),
    ("https://konto.example.org:99999", None),
])
def test_the_service_address_is_a_bare_origin_or_nothing(value, origin):
    assert account_service.service_origin(value) == origin


def test_without_an_address_the_pages_carry_nothing_of_the_account_core(client):
    response = client.get("/hub/settings")
    assert connect_src(response) == ["'self'"]
    assert "accountService" not in page_json(client, "appData")
    assert "app-account" not in db.get_ui_store()


def test_with_an_address_the_pages_name_it_and_may_reach_it(client, monkeypatch):
    monkeypatch.setenv(account_service.ENV_NAME, "http://127.0.0.1:8794/")
    for path in ("/hub", "/hub/settings", "/hub/school"):
        response = client.get(path)
        assert connect_src(response) == ["'self'", "http://127.0.0.1:8794"]
        assert page_json(client, "appData", path)["accountService"] == "http://127.0.0.1:8794"
    assert "app-account" not in db.get_ui_store(), "a page load stores nothing"
    monkeypatch.setenv(account_service.ENV_NAME, "https://konto.example.org/pfad")
    assert connect_src(client.get("/hub")) == ["'self'"]
    assert "accountService" not in page_json(client, "appData", "/hub")


def test_the_account_is_kept_on_the_device_and_left_out_of_the_export(client):
    assert client.put("/api/ui/store/app-account", json=ACCOUNT).status_code == 200
    assert db.get_ui_store()["app-account"] == ACCOUNT
    assert page_json(client, "appStore")["app-account"] == ACCOUNT
    export = client.get("/api/ui/export").get_data(as_text=True)
    assert ACCOUNT["token"] not in export and "acc-1" not in export
    assert client.delete("/api/ui/store/app-account").status_code == 200
    assert "app-account" not in db.get_ui_store()
