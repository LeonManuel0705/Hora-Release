# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from app import database as db
from app import ui_data

ROOT = Path(__file__).resolve().parent.parent
STATE = {"account": "acc-1", "cursor": 3, "latest": 3, "entries": [{"seq": 3, "at": 1800000000000, "origin": "edit", "device": "a" * 32}], "unreadable": []}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATABASE_PATH", str(tmp_path / "hub.db"))
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


def test_devices_keep_one_timetable_through_the_account_under_node():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    major = int(re.match(r"v(\d+)", subprocess.run([node, "--version"], capture_output=True, text=True).stdout).group(1))
    if major < 20:
        pytest.skip("node is too old")
    result = subprocess.run([node, str(ROOT / "tests" / "js" / "timetable_sync_check.mjs")], capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, result.stdout + result.stderr


def test_the_sync_state_is_kept_on_the_device_and_left_out_of_the_export(client):
    assert client.put("/api/ui/store/app-timetable-sync", json=STATE).status_code == 200
    assert db.get_ui_store()["app-timetable-sync"] == STATE
    assert page_json(client, "appStore")["app-timetable-sync"] == STATE
    assert "acc-1" not in client.get("/api/ui/export").get_data(as_text=True)
    assert client.delete("/api/ui/store/app-timetable-sync").status_code == 200
    assert "app-timetable-sync" not in db.get_ui_store()


def test_a_page_load_starts_no_sync(client):
    client.get("/hub")
    client.get("/hub/settings")
    assert "app-timetable-sync" not in db.get_ui_store()
