# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re
from pathlib import Path

import pytest

from app import database as db
from app import ui_data

ROOT = Path(__file__).resolve().parent.parent
NEW_PAGES = ["/hub", "/hub/tasks", "/hub/calendar", "/hub/school", "/hub/vbb", "/hub/email", "/hub/pomodoro", "/hub/bookmarks", "/hub/settings", "/hub/assistant"]
CLASSIC = re.compile(r"^/hub/(klassisch|training|review|terms|privacy)\b")


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


def page_data(html):
    return json.loads(re.search(r'<script type="application/json" id="appData">(.*?)</script>', html, re.S).group(1))


def test_the_bookmarks_page_is_part_of_the_new_interface(client):
    first = client.post("/api/hub/bookmarks", json={"title": "Schulportal", "url": "https://portal.example.org/", "category": "Work"}).get_json()["bookmark"]
    client.post("/api/hub/bookmarks", json={"title": "Wörterbuch", "url": "https://dict.example.org/"})
    html = client.get("/hub/bookmarks").get_data(as_text=True)
    assert 'data-page-module="bookmarks"' in html
    assert 'aria-current="page"' in html.split('id="navDrawer"')[1].split("</div>")[0]
    links = page_data(html)["page"]["bookmarks"]
    assert {link["title"] for link in links} == {"Schulportal", "Wörterbuch"}
    assert all(isinstance(link["id"], str) for link in links)
    assert next(link for link in links if link["title"] == "Schulportal") == {"id": str(first["id"]), "title": "Schulportal", "url": "https://portal.example.org/", "category": "Work"}
    assert page_data(html)["page"]["siteFallback"] is True


def test_the_classic_bookmarks_page_moved_out_of_the_way(client):
    assert "hub-layout" in client.get("/hub/klassisch/bookmarks").get_data(as_text=True)


@pytest.mark.parametrize("path", NEW_PAGES)
def test_no_new_page_links_into_the_classic_interface(client, path):
    html = client.get(path).get_data(as_text=True)
    targets = re.findall(r'href="([^"]+)"', html)
    assert targets
    assert not [target for target in targets if CLASSIC.match(target)]
    assert 'data-page="training"' not in html and 'data-page="review"' not in html


def test_the_phone_bundle_carries_the_bookmarks_page():
    page = (ROOT / "flutter_app" / "assets" / "ui" / "pages" / "bookmarks.html").read_text(encoding="utf-8")
    assert 'data-page-module="bookmarks"' in page
    routes = (ROOT / "flutter_app" / "lib" / "web_ui" / "ui_pages.dart").read_text(encoding="utf-8")
    assert "'/hub/bookmarks': 'bookmarks'" in routes
