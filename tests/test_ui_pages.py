# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: AGPL-3.0-only

import json
import re
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from app import database as db
from app import ui_data
from app.crypto_utils import encrypt_file

ROOT = Path(__file__).resolve().parent.parent
PAGES = ["/hub", "/hub/tasks", "/hub/calendar", "/hub/school", "/hub/vbb", "/hub/email", "/hub/pomodoro", "/hub/settings"]


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


@pytest.mark.parametrize("path", PAGES)
def test_new_pages_run_only_scripts_with_the_nonce(client, path):
    response = client.get(path)
    script_src = re.search(r"script-src ([^;]+)", response.headers["Content-Security-Policy"]).group(1)
    assert "'unsafe-inline'" not in script_src
    nonce = re.search(r"'nonce-([^']+)'", script_src).group(1)
    tags = re.findall(r"<[a-zA-Z][^>]*>", response.get_data(as_text=True))
    runnable = [tag for tag in tags if tag.startswith("<script") and 'type="application/json"' not in tag]
    assert runnable and all(f'nonce="{nonce}"' in tag for tag in runnable)
    assert not [tag for tag in tags if re.search(r"\son[a-z]+\s*=", tag)]


def test_classic_pages_keep_inline_scripts_for_now(client):
    policy = client.get("/hub/klassisch").headers["Content-Security-Policy"]
    assert "script-src 'self' 'unsafe-inline'" in policy


def test_service_worker_caches_only_existing_ui_files(monkeypatch):
    from app import ui_assets
    from app.app import app

    monkeypatch.setitem(app.config, "TESTING", True)
    with app.test_client() as anonymous:
        response = anonymous.get("/sw.js")
    assert response.status_code == 200
    assert response.mimetype == "text/javascript"
    assert response.headers["Cache-Control"] == "no-cache"
    body = response.get_data(as_text=True)
    assets = json.loads(re.search(r"const ASSETS = (\[.*?\]);", body).group(1))
    pages = json.loads(re.search(r"new Set\((\[[^\]]*\])\);\nconst BRAND", body).group(1))
    assert "/static/app/js/main.js" in assets
    assert all((ROOT / "app" / path.lstrip("/")).is_file() for path in assets)
    assert not [path for path in assets if "/api/" in path or "?" in path]
    assert pages == PAGES
    assert json.dumps(ui_assets.asset_digest()) in body


def test_only_the_hub_registers_the_service_worker(client):
    assert 'navigator.serviceWorker.register("/sw.js"' in client.get("/hub").get_data(as_text=True)
    for page in (ROOT / "flutter_app" / "assets" / "ui" / "pages").glob("*.html"):
        assert "serviceWorker" not in page.read_text(encoding="utf-8"), page.name


def test_logout_clears_the_offline_copies(client):
    response = client.post("/hub/logout")
    assert response.status_code == 200
    assert response.headers["Clear-Site-Data"] == '"cache", "storage"'


def page_data(client, path):
    html = client.get(path).get_data(as_text=True)
    match = re.search(r'<script type="application/json" id="appData">(.*?)</script>', html, re.S)
    return json.loads(match.group(1))


@pytest.mark.parametrize("path", PAGES)
def test_pages_render_with_data(client, path):
    response = client.get(path)
    assert response.status_code == 200
    data = page_data(client, path)
    assert {"tasks", "deadlines", "events", "weather", "timetable"} <= set(data)


def test_task_round_trip(client):
    today = date.today().isoformat()
    created = client.post("/api/ui/tasks", json={"title": "Vokabeln lernen", "date": today, "minutes": 25, "priority": True}).get_json()
    task = created["task"]
    assert task["title"] == "Vokabeln lernen" and task["minutes"] == 25 and task["priority"] is True
    done = client.patch(f"/api/ui/tasks/{task['id']}", json={"done": True}).get_json()["task"]
    assert done["done"] is True and done["doneDay"] == today
    assert any(item["id"] == task["id"] for item in page_data(client, "/hub")["tasks"])
    assert client.delete(f"/api/ui/tasks/{task['id']}").status_code == 200
    assert client.patch(f"/api/ui/tasks/{task['id']}", json={"done": False}).status_code == 404


def test_task_needs_a_title(client):
    response = client.post("/api/ui/tasks", json={"title": "  "})
    assert response.status_code == 400


def test_homework_deadline_round_trip(client):
    when = (date.today() + timedelta(days=3)).isoformat()
    deadline = client.post("/api/ui/deadlines", json={"kind": "Hausaufgabe", "title": "Diercke S. 24", "date": when}).get_json()["deadline"]
    assert deadline["kind"] == "Hausaufgabe" and deadline["status"] == "offen"
    changed = client.patch(f"/api/ui/deadlines/{deadline['id']}", json={"status": "abgegeben"}).get_json()["deadline"]
    assert changed["status"] == "abgegeben"
    assert client.delete(f"/api/ui/deadlines/{deadline['id']}").status_code == 200
    assert client.delete(f"/api/ui/deadlines/{deadline['id']}").status_code == 404


def own_subject(client, key, removed=False):
    own = {"custom": True, "name": "Geografie", "short": "Geo", "hue": "moss", "type": "GK", "teacher": "", "room": ""}
    body = {"items": {key: own}, "removed": [key] if removed else []}
    assert client.put("/api/ui/store/app-subjects", json=body).status_code == 200


def test_subject_made_in_settings_keeps_its_grades_tests_and_tasks(client):
    own_subject(client, "geo-own")
    semester = page_data(client, "/hub/school")["page"]["semester"]
    grade = client.post("/api/ui/grades", json={"subject": "geo-own", "points": 11, "type": "test", "semester": semester, "title": "Klimazonen"})
    assert grade.status_code == 200
    grade_id = grade.get_json()["grade"]["id"]
    assert any(item["id"] == grade_id and item["subject"] == "geo-own" for item in page_data(client, "/hub/school")["page"]["grades"])
    when = (date.today() + timedelta(days=4)).isoformat()
    test = client.post("/api/ui/deadlines", json={"kind": "Test", "title": "Stadtgeografie", "date": when, "subject": "geo-own"}).get_json()["deadline"]
    assert test["subject"] == "geo-own"
    assert any(item["id"] == test["id"] and item["subject"] == "geo-own" for item in page_data(client, "/hub/school")["deadlines"])
    task = client.post("/api/ui/tasks", json={"title": "Karte beschriften", "subject": "geo-own"}).get_json()["task"]
    assert task["subject"] == "geo-own"
    assert client.delete(f"/api/ui/grades/{grade_id}").status_code == 200


def test_removed_or_unknown_subjects_take_no_grades(client):
    own_subject(client, "geo-gone", removed=True)
    assert client.post("/api/ui/grades", json={"subject": "geo-gone", "points": 9}).status_code == 400
    assert client.post("/api/ui/grades", json={"subject": "nirgends", "points": 9}).status_code == 400


def test_event_round_trip(client):
    when = (date.today() + timedelta(days=1)).isoformat()
    event = client.post("/api/ui/events", json={"title": "Gym", "date": when, "start": "16:30", "end": "17:45", "kind": "training"}).get_json()["event"]
    assert event["kind"] == "training" and event["start"] == "16:30"
    moved = client.patch(f"/api/ui/events/{event['id']}", json={"start": "17:00"}).get_json()["event"]
    assert moved["start"] == "17:00"
    assert client.delete(f"/api/ui/events/{event['id']}").status_code == 200


def test_store_accepts_known_keys_only(client):
    assert client.put("/api/ui/store/app-motion", json="minimal").status_code == 200
    assert client.put("/api/ui/store/not-a-key", json=1).status_code == 404
    assert client.put("/api/ui/store/app-motion", data="x", content_type="text/plain").status_code == 415
    assert client.delete("/api/ui/store/app-motion").status_code == 200


def write_weather(location, fetched, today):
    tomorrow = today + timedelta(days=1)
    times = [f"{day.isoformat()}T{hour:02d}:00" for day in (today, tomorrow) for hour in range(24)]
    encrypt_file({
        "location": location,
        "timestamp": fetched.isoformat(),
        "current": {"time": f"{today.isoformat()}T10:00", "wind_speed_10m": 11.6},
        "daily": {"time": [today.isoformat(), tomorrow.isoformat()], "temperature_2m_max": [21.4, 19.0], "temperature_2m_min": [9.6, 8.0]},
        "hourly": {"time": times, "temperature_2m": [12.0 + index % 24 / 2 for index in range(48)], "precipitation_probability": [45 if index == 15 else 0 for index in range(48)]},
    }, ui_data.DATA_DIR / "weather_cache.json")


def test_weather_view_uses_hourly_forecast(monkeypatch):
    now = datetime.now()
    location = {"city": "Potsdam", "lat": 52.39, "lon": 13.06}
    write_weather(location, now, now.date())
    refreshed = []
    monkeypatch.setattr(ui_data, "refresh_weather_soon", refreshed.append)
    view = ui_data.weather({"location_json": json.dumps(location)}, now)
    assert view["place"] == "Potsdam"
    assert len(view["hours"]) == 24 and view["hours"][15]["rain"] == 45
    assert view["high"] == 21 and view["wind"] == 12
    assert view["tomorrowMorning"]["temp"] == round(12.0 + 7 / 2)
    assert refreshed == []


def test_weather_refreshes_when_stale_or_moved(monkeypatch):
    now = datetime.now()
    write_weather({"city": "Potsdam", "lat": 52.39, "lon": 13.06}, now - timedelta(hours=2), now.date())
    refreshed = []
    monkeypatch.setattr(ui_data, "refresh_weather_soon", refreshed.append)
    ui_data.weather({"location_json": json.dumps({"city": "Potsdam", "lat": 52.39, "lon": 13.06})}, now)
    moved = ui_data.weather({"location_json": json.dumps({"city": "Berlin", "lat": 52.52, "lon": 13.40})}, now)
    assert len(refreshed) == 2
    assert moved["place"] == "Berlin" and moved["hours"] == []


def test_weather_place_endpoint(client, monkeypatch):
    monkeypatch.setattr(ui_data, "geocode", lambda name: {"city": "Potsdam", "lat": 52.39, "lon": 13.06} if name == "potsdam" else None)
    response = client.put("/api/ui/weather/place", json={"name": "potsdam"})
    assert response.get_json() == {"success": True, "place": "Potsdam"}
    assert json.loads(db.get_location_setting())["city"] == "Potsdam"
    assert client.put("/api/ui/weather/place", json={"name": "Nirgendwo"}).status_code == 404
    assert client.put("/api/ui/weather/place", json={"name": ""}).status_code == 400


def test_weather_place_reports_network_trouble(client, monkeypatch):
    def broken(name):
        raise OSError("offline")

    monkeypatch.setattr(ui_data, "geocode", broken)
    assert client.put("/api/ui/weather/place", json={"name": "Potsdam"}).status_code == 502


def test_mobile_ui_assets_are_current():
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "build_mobile_ui.py"), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_the_server_sees_the_timetable_with_the_edits_from_the_settings(client):
    monday = date.today() - timedelta(days=date.today().weekday())
    client.post("/api/hub/school/timetable/entries", json={"day": 1, "block": 1, "subject": "Mathe", "subject_type": "LK", "room": "R101", "teacher": "Herr Beck"})
    client.post("/api/hub/school/timetable/entries", json={"day": 1, "block": 2, "subject": "Deutsch", "room": "R204"})
    client.put("/api/ui/store/app-subjects", json={"items": {"kunst": {"name": "Kunst", "hue": "rose", "custom": True}}})
    client.put("/api/ui/store/app-timetable-edits", json={"A:1:2": None, "B:1:2": None, "A:1:3": {"subject": "kunst", "room": "Atelier"}, "B:1:3": {"subject": "kunst", "room": "Atelier"}})
    client.put("/api/ui/store/app-block-times", json={"v": 2, "blocks": [{"n": 1, "start": "07:45", "end": "09:15"}, {"n": 2, "start": "09:35", "end": "11:05"}, {"n": 3, "start": "11:25", "end": "12:55"}]})
    school = ui_data.effective_school()
    lessons = ui_data.lessons_on(school, monday)
    assert [(lesson["block"], lesson["start"], lesson["subject"], lesson["room"]) for lesson in lessons] == [(1, "07:45", "Mathe LK", "R101"), (3, "11:25", "Kunst", "Atelier")]
    assert ui_data.lessons_on(school, monday + timedelta(days=5)) == []


def test_the_assistant_answers_with_the_edited_timetable(client):
    from app import assistant_service as ai

    client.put("/api/ui/store/app-subjects", json={"items": {"kunst": {"name": "Kunst", "hue": "rose", "custom": True}}})
    client.put("/api/ui/store/app-timetable-edits", json={f"{week}:{dow}:1": {"subject": "kunst", "room": "Atelier"} for week in "AB" for dow in range(1, 6)})
    answer = ai.offline_response("Stundenplan Montag")
    assert "Kunst" in answer and "Atelier" in answer
    context = ai.build_context(lambda: ([], [], [], [], []))
    assert "Kunst (08:00)" in context


def test_the_substitution_plan_is_served_from_the_cache(client, tmp_path, monkeypatch):
    import base64

    from app import iserv_service

    cache = tmp_path / "plan"
    cache.mkdir()
    monkeypatch.setattr(iserv_service.IServService, "VERTRETUNGSPLAN_CACHE_DIR", cache)
    service = iserv_service.get_iserv_service()
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    pdf = b"%PDF-1.4\n" + b"0" * 64
    (cache / "left_over.png").write_bytes(b"old")
    service._cache_vertretungsplan_pdfs(
        [{"data": base64.b64encode(png).decode(), "filename": "a.png"}, {"data": base64.b64encode(pdf).decode(), "filename": "b"}, {"data": base64.b64encode(b"<svg onload=alert(1)>").decode(), "filename": "c.svg"}],
        cache, cache / "cache_meta.json",
    )
    assert sorted(path.name for path in cache.iterdir()) == ["cache_meta.json", "plan_1.png", "plan_2.pdf"]
    payload = client.get("/api/ui/vplan").get_json()
    assert [(item["page"], item["type"]) for item in payload["files"]] == [(1, "image"), (2, "pdf")]
    assert payload["cachedAt"] and payload["problem"] is None
    image = client.get(payload["files"][0]["url"])
    assert image.status_code == 200 and image.mimetype == "image/png" and image.data == png
    assert image.headers["Cache-Control"] == "private, no-store"
    assert image.headers["X-Frame-Options"] == "SAMEORIGIN" and "frame-ancestors 'self'" in image.headers["Content-Security-Policy"]
    assert client.get("/api/ui/vplan/datei/3").status_code == 404
    assert client.get("/hub").headers["X-Frame-Options"] == "DENY"


def test_an_unreachable_iserv_keeps_the_last_plan(client, tmp_path, monkeypatch):
    from app import iserv_service

    cache = tmp_path / "plan"
    cache.mkdir()
    monkeypatch.setattr(iserv_service.IServService, "VERTRETUNGSPLAN_CACHE_DIR", cache)
    service = iserv_service.get_iserv_service()
    monkeypatch.setattr(service, "get_vertretungsplan_pdfs", lambda display_id=3: {"success": False, "error": "x", "needs_reconnect": True})
    payload = client.get("/api/ui/vplan?frisch=1").get_json()
    assert payload["files"] == [] and payload["problem"] == "login" and "abgelaufen" in payload["message"]


def test_written_tests_stay_in_the_page_data_for_half_a_year(client):
    key = own_subject(client, "kunst")
    for offset in (-3, -100, -300):
        client.post("/api/ui/deadlines", json={"kind": "Test", "title": f"Test {offset}", "subject": key, "date": (date.today() + timedelta(days=offset)).isoformat()})
    client.post("/api/ui/deadlines", json={"kind": "Hausaufgabe", "title": "Alt", "date": (date.today() - timedelta(days=30)).isoformat()})
    titles = [item["title"] for item in page_data(client, "/hub")["deadlines"]]
    assert [title for title in titles if title in ("Test -3", "Test -100", "Test -300", "Alt")] == ["Test -100", "Test -3"]


def test_places_keep_the_address(client, monkeypatch):
    saved = {}

    class Places:
        def save_known_location(self, key, location):
            saved[key] = location

        def get_known_locations(self):
            return {"locations": saved}

    from app import vbb_service
    monkeypatch.setattr(vbb_service, "get_vbb_service", lambda: Places())
    response = client.put("/api/ui/places/home", json={"name": "Unter den Linden 6", "area": "10117 Berlin", "lat": 52.519, "lon": 13.393, "stop": ""})
    assert response.status_code == 200
    assert page_data(client, "/hub/settings")["page"]["places"]["home"] == "Unter den Linden 6, 10117 Berlin"


def test_the_address_search_drops_doubles_and_names_the_postcode(monkeypatch):
    from app import transit_service

    hits = [
        {"type": "ADDRESS", "name": "Unter den Linden 6", "zip": "10117", "country": "DE", "lat": 52.5190, "lon": 13.3928, "areas": [{"name": "Berlin", "default": True}]},
        {"type": "ADDRESS", "name": "Unter den Linden 6", "zip": "10117", "country": "DE", "lat": 52.5185, "lon": 13.3929, "areas": [{"name": "Berlin", "default": True}]},
        {"type": "ADDRESS", "name": "Unter den Linden 6", "zip": "21255", "country": "DE", "lat": 53.28, "lon": 9.71, "areas": [{"name": "Tostedt", "default": True}]},
        {"type": "STOP", "name": "Unter den Linden", "id": "de-1", "country": "DE", "lat": 52.51, "lon": 13.38, "areas": [{"name": "Berlin", "default": True}], "modes": ["BUS"]},
    ]
    monkeypatch.setattr(transit_service, "fetch", lambda path, params, ttl: hits)
    places = transit_service.search({"q": "Unter den Linden 6"})[0]["places"]
    assert [(place["kind"], place["name"], place["area"]) for place in places] == [
        ("address", "Unter den Linden 6", "10117 Berlin"),
        ("address", "Unter den Linden 6", "21255 Tostedt"),
        ("stop", "Unter den Linden", "Berlin"),
    ]


def test_a_saved_review_comes_back_with_its_answers(client):
    created = client.post("/api/hub/reviews", json={"type": "daily", "date": "2026-10-04", "achieved": "Mathe geübt", "energy": 4}).get_json()["review"]
    assert created["achieved"] == "Mathe geübt" and created["energy"] == 4
    listed = client.get("/api/hub/reviews").get_json()["reviews"]
    assert [(review["date"], review["achieved"]) for review in listed if review["id"] == created["id"]] == [("2026-10-04", "Mathe geübt")]
    client.put(f"/api/hub/reviews/{created['id']}", json={"achieved": "Mathe und Physik", "went_well": "Fokus"})
    again = client.get(f"/api/hub/reviews/{created['id']}").get_json()["review"]
    assert (again["achieved"], again["went_well"], again["date"]) == ("Mathe und Physik", "Fokus", "2026-10-04")


def test_the_automatic_colour_scheme_survives_a_reload(client):
    client.put("/api/ui/store/app-theme-choice", json="dark")
    assert 'data-theme-mode="dark"' in client.get("/hub").get_data(as_text=True)
    client.put("/api/ui/store/app-theme-choice", json="auto")
    assert 'data-theme-mode="auto"' in client.get("/hub").get_data(as_text=True)
