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
RECORD = {"at": 1800000000000, "origin": "edit", "device": "5e7c0f3a9b214d6e8a1f0c2b3d4e5f60", "seen": 1800000000000}


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


@pytest.mark.parametrize("check", ["plan_meta_check.mjs", "settings_plan_record_check.mjs"])
def test_every_change_of_the_plan_leaves_its_record_under_node(check):
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    major = int(re.match(r"v(\d+)", subprocess.run([node, "--version"], capture_output=True, text=True).stdout).group(1))
    if major < 20:
        pytest.skip("node is too old")
    result = subprocess.run([node, str(ROOT / "tests" / "js" / check)], capture_output=True, text=True, timeout=180)
    assert result.returncode == 0, result.stdout + result.stderr


def test_the_page_knows_the_device_and_it_stays_the_same(client, tmp_path, monkeypatch):
    first = page_json(client, "appData")["device"]
    assert re.fullmatch(r"[0-9a-f]{32}", first)
    assert page_json(client, "appData", "/hub")["device"] == first
    assert db.device_id() == first
    monkeypatch.setattr(db, "DATABASE_PATH", str(tmp_path / "other.db"))
    db.init_db()
    assert db.device_id() != first, "another installation has an id of its own"


def test_the_device_id_is_no_stored_value_and_no_part_of_an_export(client):
    device = page_json(client, "appData")["device"]
    assert db.DEVICE_KEY not in db.get_ui_store()
    assert device not in json.dumps(page_json(client, "appStore"))
    assert device not in client.get("/api/ui/export").get_data(as_text=True)
    assert client.put(f"/api/ui/store/{db.DEVICE_KEY}", json="0" * 32).status_code == 404
    assert db.device_id() == device


def test_the_plan_record_is_kept_like_the_plan(client):
    assert client.put("/api/ui/store/app-timetable-meta", json=RECORD).status_code == 200
    assert db.get_ui_store()["app-timetable-meta"] == RECORD
    assert page_json(client, "appStore")["app-timetable-meta"] == RECORD
    assert client.delete("/api/ui/store/app-timetable-meta").status_code == 200
    assert "app-timetable-meta" not in db.get_ui_store()


def test_a_page_load_writes_no_record(client):
    client.get("/hub/settings")
    client.get("/hub/school")
    assert "app-timetable-meta" not in db.get_ui_store()
