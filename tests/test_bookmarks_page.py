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
    assert next(link for link in links if link["title"] == "Schulportal") == {"id": str(first["id"]), "title": "Schulportal", "url": "https://portal.example.org/", "category": "Work", "icon": None}
    assert page_data(html)["page"]["siteFallback"] is True


@pytest.mark.parametrize("url", ["javascript:alert(1)", "kein link", "ftp://files.example.org/", "https://", "mailto:x@example.org", "data:text/html,x"])
def test_only_web_addresses_are_kept_like_on_the_phone(client, url):
    response = client.post("/api/hub/bookmarks", json={"title": "X", "url": url})
    assert response.status_code == 400 and response.get_json()["success"] is False
    assert client.get("/api/hub/bookmarks").get_json()["bookmarks"] == []


def test_a_bookmark_needs_a_title_and_one_of_the_four_categories(client):
    assert client.post("/api/hub/bookmarks", json={"title": " ", "url": "https://example.org/"}).status_code == 400
    made = client.post("/api/hub/bookmarks", json={"title": "X", "url": "https://example.org/", "category": "Hack"}).get_json()["bookmark"]
    assert made["category"] == "Other"
    assert client.put(f"/api/hub/bookmarks/{made['id']}", json={"url": "javascript:alert(1)"}).status_code == 400
    assert client.put(f"/api/hub/bookmarks/{made['id']}", json={"category": "Dev"}).get_json()["bookmark"]["category"] == "Dev"
    kept = client.get("/api/hub/bookmarks").get_json()["bookmarks"]
    assert [(link["url"], link["category"]) for link in kept] == [("https://example.org/", "Dev")]


def test_the_classic_bookmarks_page_moved_out_of_the_way(client):
    assert "hub-layout" in client.get("/hub/klassisch/bookmarks").get_data(as_text=True)


@pytest.mark.parametrize("path", NEW_PAGES)
def test_no_new_page_links_into_the_classic_interface(client, path):
    html = client.get(path).get_data(as_text=True)
    targets = re.findall(r'href="([^"]+)"', html)
    assert targets
    assert not [target for target in targets if CLASSIC.match(target)]
    assert 'data-page="training"' not in html and 'data-page="review"' not in html


def test_the_new_scripts_send_nobody_to_a_classic_page():
    offenders = []
    for path in (ROOT / "app" / "static" / "app" / "js").rglob("*.js"):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"/hub/(klassisch|training|review)\b", line):
                offenders.append(f"{path.relative_to(ROOT)}:{number}")
    assert not offenders


def test_the_phone_bundle_carries_the_bookmarks_page():
    page = (ROOT / "flutter_app" / "assets" / "ui" / "pages" / "bookmarks.html").read_text(encoding="utf-8")
    assert 'data-page-module="bookmarks"' in page
    routes = (ROOT / "flutter_app" / "lib" / "web_ui" / "ui_pages.dart").read_text(encoding="utf-8")
    assert "'/hub/bookmarks': 'bookmarks'" in routes
