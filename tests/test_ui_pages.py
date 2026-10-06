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


def test_an_own_subject_that_was_deleted_keeps_showing_its_grades(client):
    own_subject(client, "geo-kept")
    semester = page_data(client, "/hub/school")["page"]["semester"]
    grade = client.post("/api/ui/grades", json={"subject": "geo-kept", "points": 11, "type": "test", "semester": semester, "title": "Klimazonen"}).get_json()["grade"]
    when = (date.today() + timedelta(days=4)).isoformat()
    test = client.post("/api/ui/deadlines", json={"kind": "Test", "title": "Stadtgeografie", "date": when, "subject": "geo-kept"}).get_json()["deadline"]
    assert page_data(client, "/hub/settings")["page"]["subjectUse"]["geo-kept"] == {"grades": 1, "entries": 1}

    own_subject(client, "geo-kept", removed=True)
    school = page_data(client, "/hub/school")
    assert any(item["id"] == grade["id"] and item["subject"] == "geo-kept" for item in school["page"]["grades"])
    assert any(item["id"] == test["id"] and item["subject"] == "geo-kept" for item in school["deadlines"])
    assert ui_data.effective_school()["subjects"]["geo-kept"] == {"name": "Geografie", "type": "GK", "retired": True, "teacher": ""}
    assert client.post("/api/ui/grades", json={"subject": "geo-kept", "points": 9}).status_code == 400

    # A task keeps a subject that was put aside, as when it is restored after a delete or repeats.
    task = client.post("/api/ui/tasks", json={"title": "Karte zeichnen", "subject": "geo-kept"}).get_json()["task"]
    assert task["subject"] == "geo-kept"
    assert client.delete(f"/api/ui/tasks/{task['id']}").status_code == 200

    own_subject(client, "geo-kept")
    assert ui_data.effective_school()["subjects"]["geo-kept"]["retired"] is False
    assert client.delete(f"/api/ui/grades/{grade['id']}").status_code == 200
    assert client.delete(f"/api/ui/deadlines/{test['id']}").status_code == 200
    assert "geo-kept" not in page_data(client, "/hub/settings")["page"]["subjectUse"]


def test_an_own_subject_in_use_cannot_be_dropped_from_the_store(client):
    stored = lambda: db.get_ui_store()["app-subjects"]
    own_subject(client, "geo-used")
    semester = page_data(client, "/hub/school")["page"]["semester"]
    grade = client.post("/api/ui/grades", json={"subject": "geo-used", "points": 12, "type": "test", "semester": semester, "title": "Karten"}).get_json()["grade"]
    assert client.get("/api/ui/subjects/use").get_json()["use"]["geo-used"] == {"grades": 1, "entries": 0}

    # The page lost track of the grade and asks for the subject to go for good, once by storing without it, once by clearing the store.
    other = {"custom": True, "name": "Astronomie", "short": "Ast", "hue": "sky", "type": "GK", "teacher": "", "room": ""}
    assert client.put("/api/ui/store/app-subjects", json={"items": {"astro-new": other}, "removed": []}).status_code == 200
    assert set(stored()["items"]) == {"astro-new", "geo-used"} and stored()["removed"] == ["geo-used"]
    assert client.delete("/api/ui/store/app-subjects").status_code == 200
    assert set(stored()["items"]) == {"geo-used"} and stored()["removed"] == ["geo-used"]
    assert any(item["id"] == grade["id"] for item in page_data(client, "/hub/school")["page"]["grades"])

    # Keeping the key but storing something under it that is no subject does not get rid of it either.
    whole = stored()["items"]["geo-used"]
    for broken in ({}, {**whole, "custom": False}, {**whole, "name": " "}, {**whole, "hue": "kein-farbton"}, "Geografie", None):
        assert client.put("/api/ui/store/app-subjects", json={"items": {"geo-used": broken}, "removed": []}).status_code == 200
        assert stored()["items"]["geo-used"] == whole and stored()["removed"] == ["geo-used"]
    assert any(item["id"] == grade["id"] for item in page_data(client, "/hub/school")["page"]["grades"])
    # An edit that leaves it a subject goes through.
    assert client.put("/api/ui/store/app-subjects", json={"items": {"geo-used": {**whole, "name": "Erdkunde"}}, "removed": []}).status_code == 200
    assert stored()["items"]["geo-used"]["name"] == "Erdkunde" and stored()["removed"] == []

    # Without anything hanging on it, it goes.
    assert client.delete(f"/api/ui/grades/{grade['id']}").status_code == 200
    assert client.delete("/api/ui/store/app-subjects").status_code == 200
    assert "app-subjects" not in db.get_ui_store()


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


def test_without_a_place_of_its_own_the_weather_follows_home(client, monkeypatch):
    saved = {}

    class Places:
        def save_known_location(self, key, location):
            saved[key] = location

        def delete_known_location(self, key):
            saved.pop(key, None)

        def get_known_locations(self):
            return {"locations": saved}

    from app import vbb_service
    monkeypatch.setattr(vbb_service, "get_vbb_service", lambda: Places())
    refreshed = []
    monkeypatch.setattr(ui_data, "refresh_weather_soon", refreshed.append)
    assert ui_data.weather_location({}) is None
    home = {"name": "Unter den Linden 6", "area": "10117 Berlin", "lat": 52.5191, "lon": 13.3937, "stop": ""}
    berlin = {"city": "Berlin", "lat": 52.5, "lon": 13.4, "home": True}
    assert client.put("/api/ui/places/home", json=home).get_json()["weatherFromHome"] == "Berlin"
    assert refreshed == [berlin]
    assert ui_data.weather_location({}) == berlin
    places = page_data(client, "/hub/settings")["page"]["places"]
    assert (places["weather"], places["weatherFromHome"], places["weatherCanFollowHome"]) == ("", "Berlin", True)

    monkeypatch.setattr(ui_data, "geocode", lambda name: {"city": "Potsdam", "lat": 52.39, "lon": 13.06})
    client.put("/api/ui/weather/place", json={"name": "Potsdam"})
    places = page_data(client, "/hub/settings")["page"]["places"]
    assert (places["weather"], places["weatherFromHome"]) == ("Potsdam", None)
    assert client.put("/api/ui/places/home", json=home).get_json()["weatherFromHome"] is None

    assert client.put("/api/ui/weather/place", json={"name": ""}).get_json() == {"success": True, "place": "", "weatherFromHome": "Berlin"}
    gone = client.delete("/api/ui/places/home").get_json()
    assert (gone["weatherFromHome"], gone["weatherCanFollowHome"]) == (None, False)
    assert page_data(client, "/hub/settings")["page"]["places"]["weatherCanFollowHome"] is False
    assert ui_data.weather_location({}) is None
    assert client.put("/api/ui/weather/place", json={"name": ""}).status_code == 400


def test_the_forecast_of_a_place_that_is_no_longer_set_is_not_shown(client, monkeypatch):
    saved = {"home": {"name": "Unter den Linden 6", "address": "10117 Berlin", "latitude": 52.5191, "longitude": 13.3937, "type": "location"}}

    class Places:
        def delete_known_location(self, key):
            saved.pop(key, None)

        def get_known_locations(self):
            return {"locations": saved}

    from app import vbb_service
    monkeypatch.setattr(vbb_service, "get_vbb_service", lambda: Places())
    refreshed = []
    monkeypatch.setattr(ui_data, "refresh_weather_soon", refreshed.append)
    now = datetime.now()
    write_weather({"city": "Berlin", "lat": 52.5, "lon": 13.4, "home": True}, now, now.date())
    shown = ui_data.weather({}, now)
    assert (shown["place"], shown["fromHome"], len(shown["hours"])) == ("Berlin", True, 24)

    # Home goes and nothing else is set: no place, no numbers from before, and the page can ask for a place.
    assert client.delete("/api/ui/places/home").status_code == 200
    gone = ui_data.weather({}, now)
    assert (gone["place"], gone["fromHome"], gone["canFollowHome"], gone["hours"], gone["high"]) == ("", False, True, [], None)
    assert refreshed == []

    # The same town somewhere else is another place: its forecast is fetched and the old one not shown for it.
    saved["home"] = {"name": "Hauptstraße 1", "address": "13353 Berlin", "latitude": 52.9, "longitude": 13.9, "type": "location"}
    moved = ui_data.weather({}, now)
    assert (moved["place"], moved["hours"]) == ("Berlin", []) and refreshed == [{"city": "Berlin", "lat": 52.9, "lon": 13.9, "home": True}]


@pytest.mark.parametrize("address, name, town", [
    ("10117 Berlin", "Unter den Linden 6", "Berlin"),
    ("Unter den Linden 6, 10117 Berlin", "Zuhause", "Berlin"),
    ("", "15230 Frankfurt (Oder)", "Frankfurt (Oder)"),
    ("Frankfurt (Oder)", "Lindenallee 1", "Frankfurt (Oder)"),
    ("15230", "Lindenallee 1", ""),
    ("", "Unter den Linden 6", ""),
    ("", "S Frankfurt (Oder) Bhf", ""),
])
def test_home_is_named_after_its_town_or_not_at_all(address, name, town):
    assert ui_data.home_town({"address": address, "name": name}) == town


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


def test_a_removed_place_can_be_put_back(client, monkeypatch):
    saved = {}

    class Places:
        def save_known_location(self, key, location):
            saved[key] = location

        def get_known_locations(self):
            return {"locations": saved}

        def delete_known_location(self, key):
            saved.pop(key, None)

    from app import vbb_service
    monkeypatch.setattr(vbb_service, "get_vbb_service", lambda: Places())
    place = {"name": "Hauptbahnhof", "area": "", "lat": 52.525, "lon": 13.369, "stop": "de:11000:900003201"}
    assert client.put("/api/ui/places/school", json=place).status_code == 200
    before = dict(saved["school"])
    removed = client.delete("/api/ui/places/school").get_json()["removed"]
    assert removed == place and "school" not in saved
    assert client.put("/api/ui/places/school", json=removed).status_code == 200
    assert saved["school"] == before
    assert client.delete("/api/ui/places/home").get_json()["removed"] is None


def test_plan_pages_keep_their_address_until_their_content_changes(client, tmp_path, monkeypatch):
    import base64

    from app import iserv_service

    cache = tmp_path / "plan"
    cache.mkdir()
    monkeypatch.setattr(iserv_service.IServService, "VERTRETUNGSPLAN_CACHE_DIR", cache)
    service = iserv_service.get_iserv_service()

    def addresses(*pages):
        files = [{"data": base64.b64encode(b"\x89PNG\r\n\x1a\n" + page).decode(), "filename": "x.png"} for page in pages]
        service._cache_vertretungsplan_pdfs(files, cache, cache / "cache_meta.json")
        return [item["url"] for item in client.get("/api/ui/vplan").get_json()["files"]]

    first = addresses(b"monday", b"tuesday")
    assert addresses(b"monday", b"tuesday") == first
    changed = addresses(b"monday", b"wednesday")
    assert changed[0] == first[0] and changed[1] != first[1]
    assert client.get(changed[1]).data.endswith(b"wednesday")


def test_the_server_names_the_teacher_the_settings_name(client):
    monday = date.today() - timedelta(days=date.today().weekday())
    client.post("/api/hub/school/timetable/entries", json={"day": 1, "block": 1, "subject": "Mathe", "subject_type": "LK", "room": "R101", "teacher": "Herr Beck"})
    client.post("/api/hub/school/timetable/entries", json={"day": 1, "block": 2, "subject": "Deutsch", "room": "R204", "teacher": "Frau Busch"})

    def teachers():
        return {lesson["subject"]: lesson["teacher"] for lesson in ui_data.lessons_on(ui_data.effective_school(), monday)}

    assert teachers() == {"Mathe LK": "Herr Beck", "Deutsch": "Frau Busch"}
    math = next(key for key, info in ui_data.effective_school()["subjects"].items() if info["name"] == "Mathe LK")
    client.put("/api/ui/store/app-teachers", json={"items": {"t-herr-beck": {"title": "Herr", "name": "Becker"}}})
    assert teachers()["Mathe LK"] == "Herr Becker"
    client.put("/api/ui/store/app-subjects", json={"items": {math: {"teacher": "t-frau-busch"}}})
    assert teachers()["Mathe LK"] == "Frau Busch"
    client.put("/api/ui/store/app-timetable-edits", json={"A:1:1": {"subject": math, "room": "R101", "teacher": "t-herr-beck"}, "B:1:1": {"subject": math, "room": "R101", "teacher": "t-herr-beck"}})
    assert teachers()["Mathe LK"] == "Herr Becker"
    client.put("/api/ui/store/app-teachers", json={"items": {}, "removed": ["t-frau-busch", "t-herr-beck"]})
    assert teachers() == {"Mathe LK": "", "Deutsch": ""}


def test_school_free_days_have_no_lessons(client):
    from app import assistant_service as ai

    monday = date.today() - timedelta(days=date.today().weekday())
    for dow in range(1, 6):
        client.post("/api/hub/school/timetable/entries", json={"day": dow, "block": 1, "subject": "Mathe", "room": "R101"})
    assert len(ui_data.lessons_on(ui_data.effective_school(), monday)) == 1
    db.create_holiday(monday.isoformat(), "Herbstferien", "BB", monday.year, end_date=(monday + timedelta(days=13)).isoformat(), holiday_type="schulferien")
    school = ui_data.effective_school()
    assert ui_data.lessons_on(school, monday) == [] and ui_data.holiday_on(school, monday) == "Herbstferien"
    assert ui_data.lessons_on(school, monday + timedelta(days=11)) == []
    assert len(ui_data.lessons_on(school, monday + timedelta(days=14))) == 1
    assert "Herbstferien" in ai.offline_response("Stundenplan Montag")
    context = ai.build_context(lambda: ([], [], [], [], []))
    assert "schulfrei (Herbstferien)" in context and "--- Stundenplan heute" not in context


def test_an_expired_iserv_session_is_renewed_once(client, tmp_path, monkeypatch):
    import base64

    from app import iserv_service

    cache = tmp_path / "plan"
    monkeypatch.setattr(iserv_service.IServService, "VERTRETUNGSPLAN_CACHE_DIR", cache)
    service = iserv_service.get_iserv_service()
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"plan").decode()
    answers = [{"success": False, "error": "Sitzung abgelaufen", "expired": True}, {"success": True, "pdfs": [{"data": png, "filename": "a.png"}]}]
    logins = []
    monkeypatch.setattr(service, "is_connected", lambda: True)
    monkeypatch.setattr(service, "load_credentials", lambda: {"username": "u", "password": "p", "iserv_url": "schule.example"})
    monkeypatch.setattr(service, "connect", lambda *args, **kwargs: logins.append(1) or {"success": True})
    monkeypatch.setattr(service, "_fetch_vertretungsplan_pdfs", lambda display_id=3: answers.pop(0))
    payload = client.get("/api/ui/vplan?frisch=1").get_json()
    assert len(logins) == 1 and payload["problem"] is None and len(payload["files"]) == 1

    answers[:] = [{"success": False, "error": "Sitzung abgelaufen", "expired": True}] * 2
    payload = client.get("/api/ui/vplan?frisch=1").get_json()
    assert len(logins) == 2 and payload["problem"] == "login" and len(payload["files"]) == 1


@pytest.mark.parametrize("state, problem", [
    ({"fetch": {"success": False, "error": "Keine PDFs gefunden"}}, "empty"),
    ({"fetch": {"success": False, "error": "HTTP 503"}}, "offline"),
    ({"fetch": {"success": False, "error": "Kein Zugriff auf die Anzeige", "denied": True}}, "empty"),
    ({"fetch": {"success": False, "error": "Sitzung abgelaufen", "expired": True}, "after": False, "login": {"success": False, "error": "Server nicht erreichbar. Bitte URL überprüfen."}}, "offline"),
    ({"fetch": {"success": False, "error": "Sitzung abgelaufen", "expired": True}, "after": False, "login": {"success": False, "error": "Falscher Benutzername oder Passwort"}}, "login"),
    ({"connected": False, "login": {"success": False, "error": "Server nicht erreichbar. Bitte URL überprüfen."}}, "offline"),
    ({"connected": False, "login": {"success": False, "error": "Falscher Benutzername oder Passwort"}}, "login"),
    ({"connected": False, "credentials": None}, "setup"),
])
def test_the_plan_names_the_real_reason_it_is_missing(client, tmp_path, monkeypatch, state, problem):
    from app import iserv_service

    monkeypatch.setattr(iserv_service.IServService, "VERTRETUNGSPLAN_CACHE_DIR", tmp_path / "plan")
    service = iserv_service.get_iserv_service()
    online = {"now": state.get("connected", True)}

    def sign_in(*args, **kwargs):
        online["now"] = state.get("after", online["now"])
        return state.get("login", {"success": True})

    monkeypatch.setattr(service, "is_connected", lambda: online["now"])
    monkeypatch.setattr(service, "load_credentials", lambda: state.get("credentials", {"username": "u", "password": "p", "iserv_url": "schule.example"}))
    monkeypatch.setattr(service, "connect", sign_in)
    monkeypatch.setattr(service, "_fetch_vertretungsplan_pdfs", lambda display_id=3: state["fetch"])
    assert client.get("/api/ui/vplan?frisch=1").get_json()["problem"] == problem


def test_the_iserv_login_page_is_told_from_a_plan():
    from types import SimpleNamespace

    from app import iserv_service

    def page(url, body="", kind="text/html; charset=utf-8"):
        return SimpleNamespace(url=url, text=body, headers={"Content-Type": kind})

    assert iserv_service._is_login_page(page("https://schule.example/iserv/auth/login?_target_path=x"))
    assert iserv_service._is_login_page(page("https://schule.example/iserv/infodisplay/show/3", '<input name="_username"><input name="_password">'))
    assert not iserv_service._is_login_page(page("https://schule.example/iserv/infodisplay/show/3", "<img src='/iserv/infodisplay/file/3/1'>"))
    assert not iserv_service._is_login_page(page("https://schule.example/iserv/infodisplay/file/3/1", "", "image/png"))


def test_mail_drafts_outlive_the_page(client, monkeypatch):
    from app import ui_pages

    drafts = lambda: [(item["id"], item["to"], item["subject"], item["body"]) for item in page_data(client, "/hub/email")["page"]["drafts"]]
    assert drafts() == []
    letter = {"to": "ben@example.org", "subject": "Referat", "body": "Hallo Ben,\nwann treffen wir uns?", "replyTo": None, "account": None}
    assert client.put("/api/ui/mail/drafts/draft-1759700000000", json=letter).status_code == 200
    assert drafts() == [("draft-1759700000000", "ben@example.org", "Referat", letter["body"])]
    client.put("/api/ui/mail/drafts/draft-1759700000001", json={"to": "", "subject": "Zweiter", "body": ""})
    client.put("/api/ui/mail/drafts/draft-1759700000000", json={**letter, "subject": "Referat Bio"})
    assert sorted(item[2] for item in drafts()) == ["Referat Bio", "Zweiter"]
    assert client.put("/api/ui/mail/drafts/draft-1759700000001", json={"to": " ", "subject": "", "body": "  "}).status_code == 200
    assert [item[2] for item in drafts()] == ["Referat Bio"]
    assert client.delete("/api/ui/mail/drafts/draft-1759700000000").status_code == 200
    assert client.delete("/api/ui/mail/drafts/draft-1759700000000").status_code == 200
    assert drafts() == []
    assert client.put("/api/ui/mail/drafts/entwurf", json=letter).status_code == 404
    assert client.put("/api/ui/mail/drafts/draft-1", data="x").status_code == 400

    # A long mail is kept as long as it could be sent.
    long = "Zeile mit Umlauten äöü\n" * 2500
    assert client.put("/api/ui/mail/drafts/draft-2", json={**letter, "body": long}).status_code == 200
    assert drafts()[0][3] == long

    # When the store is full a further draft is refused. Nothing that is there is dropped for it, and it can still be changed.
    monkeypatch.setattr(ui_pages, "MAIL_DRAFTS", 2)
    assert client.put("/api/ui/mail/drafts/draft-3", json=letter).status_code == 200
    assert client.put("/api/ui/mail/drafts/draft-4", json=letter).status_code == 409
    assert client.put("/api/ui/mail/drafts/draft-2", json={**letter, "subject": "Geändert"}).status_code == 200
    assert sorted(item[0] for item in drafts()) == ["draft-2", "draft-3"]
    for ref in ("draft-2", "draft-3"):
        assert client.delete(f"/api/ui/mail/drafts/{ref}").status_code == 200


def test_a_mail_put_into_the_archive_stays_there(client, monkeypatch):
    from app import ui_pages

    account = {"email": "leon@example.org", "name": "Mail", "kind": "imap"}
    mails = [{"id": "7", "from": "a@example.org", "subject": "Hallo", "date": "2026-10-05 10:00"}, {"id": "8", "from": "b@example.org", "subject": "Termin", "date": "2026-10-05 11:00"}]
    monkeypatch.setattr(ui_pages, "_mail_accounts", lambda: [account])
    monkeypatch.setattr(ui_pages, "_fetch_inbox", lambda account, limit: (True, mails))
    folders = lambda: {item["uid"]: item["folder"] for item in client.get("/api/ui/mail").get_json()["messages"]}
    assert folders() == {"7": "inbox", "8": "inbox"}
    assert client.put("/api/ui/mail/archive", json={"id": "leon@example.org|7", "archived": True}).status_code == 200
    assert folders() == {"7": "archive", "8": "inbox"}
    client.put("/api/ui/mail/archive", json={"id": "leon@example.org|7", "archived": True})
    assert len(ui_data.load_list("mail_archive")) == 1
    assert client.put("/api/ui/mail/archive", json={"id": "leon@example.org|7", "archived": False}).status_code == 200
    assert folders() == {"7": "inbox", "8": "inbox"}
    assert client.put("/api/ui/mail/archive", json={"id": "", "archived": True}).status_code == 400
    assert client.put("/api/ui/mail/archive", json={"id": "ohne-konto", "archived": True}).status_code == 400


def test_an_archived_mail_stays_listed_once_the_mailbox_no_longer_sends_it(client, monkeypatch):
    from app import ui_pages

    account = {"email": "leon@example.org", "name": "Mail", "kind": "imap"}
    old = {"id": "7", "from": "a@example.org", "from_name": "Anna", "subject": "Hallo", "date": "2026-10-05 10:00", "preview": "Bis Freitag"}
    newer = [{"id": str(number), "from": "b@example.org", "subject": f"Mail {number}", "date": "2026-10-06 09:00"} for number in (8, 9)]
    inbox = [old, *newer]
    monkeypatch.setattr(ui_pages, "_mail_accounts", lambda: [account])
    monkeypatch.setattr(ui_pages, "_fetch_inbox", lambda account, limit: (True, inbox))
    listed = lambda: {item["uid"]: item for item in client.get("/api/ui/mail").get_json()["messages"]}
    shown = listed()["7"]
    assert client.put("/api/ui/mail/archive", json={"id": shown["id"], "archived": True, "mail": {**shown, "body": "x" * 5000}}).status_code == 200
    assert len(ui_data.load_list("mail_archive")[0]["mail"]["preview"]) == 300
    client.put("/api/ui/mail/archive", json={"id": shown["id"], "archived": True, "mail": shown})

    # Newer mails have pushed it out of what the mailbox sends. It is still in the archive, with what its row showed.
    inbox = newer
    kept = listed()
    assert sorted(kept) == ["7", "8", "9"]
    assert {key: kept["7"][key] for key in ("id", "folder", "subject", "received", "body", "read", "partial", "old")} == {
        "id": "leon@example.org|7", "folder": "archive", "subject": "Hallo", "received": "2026-10-05T10:00", "body": "Bis Freitag", "read": True, "partial": True, "old": True}
    assert "old" not in kept["8"]

    # Opening it asks the mailbox. If the mail was moved or deleted in another app, the page is told that it is gone.
    from app import email_service, google_oauth
    monkeypatch.setattr(google_oauth, "get_google_accounts", lambda: [])
    monkeypatch.setattr(email_service, "get_email_detail", lambda account, uid, folder: {"success": False, "error": "Could not fetch email", "gone": True})
    answer = client.get("/api/ui/mail/message?account=leon@example.org&id=7")
    assert answer.status_code == 404 and answer.get_json()["gone"] is True
    monkeypatch.setattr(email_service, "get_email_detail", lambda account, uid, folder: {"success": False, "error": "An error occurred"})
    answer = client.get("/api/ui/mail/message?account=leon@example.org&id=7")
    assert answer.status_code == 502 and "gone" not in answer.get_json()
    assert kept["7"]["peer"] == {"name": "Anna", "role": "other", "detail": "a@example.org"}

    # While the mailbox still sends it, it is not listed twice. A mailbox that is no longer connected lists nothing.
    inbox = [old, *newer]
    assert len(client.get("/api/ui/mail").get_json()["messages"]) == 3
    monkeypatch.setattr(ui_pages, "_mail_accounts", lambda: [])
    assert client.get("/api/ui/mail").get_json()["messages"] == []
    monkeypatch.setattr(ui_pages, "_mail_accounts", lambda: [account])
    assert client.put("/api/ui/mail/archive", json={"id": "leon@example.org|7", "archived": False}).status_code == 200
    inbox = newer
    assert sorted(listed()) == ["8", "9"]


def test_sending_a_mail_removes_the_draft_it_was_kept_as(client, monkeypatch):
    from app import email_service, google_oauth

    sent, listed_meanwhile = [], []
    drafts = lambda: [item["id"] for item in page_data(client, "/hub/email")["page"]["drafts"]]
    unsent = lambda: {item["id"]: item["unsent"] for item in page_data(client, "/hub/email")["page"]["drafts"]}

    def send(account, to, subject, body):
        # What a page would be given that is loaded while the mail server is still being talked to.
        listed_meanwhile.append(sorted(item["id"] for item in ui_data.mail_drafts()))
        sent.append(to)
        return {"success": to != "falsch@example.org"}

    monkeypatch.setattr(google_oauth, "get_google_accounts", lambda: [])
    monkeypatch.setattr(email_service, "send_email", send)
    letter = {"to": "ben@example.org", "subject": "Referat", "body": "Hallo Ben"}
    for ref in ("draft-10", "draft-11"):
        assert client.put(f"/api/ui/mail/drafts/{ref}", json=letter).status_code == 200

    # A mail the server did not take keeps its draft, and the draft says that the mail did not go out.
    refused = client.post("/api/ui/mail/send", json={**letter, "account": "leon@example.org", "to": "falsch@example.org", "draft": "draft-10"})
    assert refused.status_code == 502 and unsent() == {"draft-10": True, "draft-11": False}
    # Storing it again, as the page does when it is edited, makes it an ordinary draft.
    client.put("/api/ui/mail/drafts/draft-10", json=letter)
    assert unsent() == {"draft-10": False, "draft-11": False}
    assert client.post("/api/ui/mail/send", json={**letter, "account": "leon@example.org", "draft": "draft-10"}).status_code == 200
    assert drafts() == ["draft-11"] and sent == ["falsch@example.org", "ben@example.org"]
    # While either mail was on its way, its draft was not offered to a page.
    assert listed_meanwhile == [["draft-11"], ["draft-11"]]
    assert client.post("/api/ui/mail/send", json={**letter, "account": "leon@example.org", "draft": "../x"}).status_code == 200
    assert drafts() == ["draft-11"]

    # The page marks the draft the moment "Senden" is pressed. If the app is closed before the mail leaves,
    # the draft is back once the mail can no longer be on its way, and says that it was not sent.
    assert client.put("/api/ui/mail/drafts/draft-12", json={**letter, "sending": True}).status_code == 200
    assert drafts() == ["draft-11"]
    later = datetime.now() + ui_data.MAIL_SENDING + timedelta(seconds=1)
    assert {item["id"]: item["unsent"] for item in ui_data.mail_drafts(later)} == {"draft-11": False, "draft-12": True}
    for ref in ("draft-11", "draft-12"):
        assert client.delete(f"/api/ui/mail/drafts/{ref}").status_code == 200


def test_notes_and_ideas_can_be_seen_changed_and_removed(client):
    listed = lambda: [(item["type"], item["title"], item["details"]) for item in page_data(client, "/hub/tasks")["page"]["notes"]]
    assert listed() == []
    note = client.post("/api/ui/notes", json={"type": "note", "title": "Ben wegen Referat fragen", "details": "Thema Vulkane"}).get_json()["note"]
    idea = client.post("/api/ui/notes", json={"type": "idea", "title": "Lernkarten für Bio", "created": "2026-10-01T08:00:00"}).get_json()["note"]
    assert (note["type"], idea["type"], idea["created"]) == ("note", "idea", "2026-10-01T08:00:00")
    assert listed() == [("note", "Ben wegen Referat fragen", "Thema Vulkane"), ("idea", "Lernkarten für Bio", "")]

    changed = client.patch(f"/api/ui/notes/{idea['id']}", json={"title": "Lernkarten für Bio und Chemie", "details": "mit Bildern", "type": "note"}).get_json()["note"]
    assert (changed["type"], changed["title"], changed["details"], changed["created"]) == ("note", "Lernkarten für Bio und Chemie", "mit Bildern", "2026-10-01T08:00:00")
    assert client.patch(f"/api/ui/notes/{idea['id']}", json={"title": "  "}).status_code == 400
    assert client.patch("/api/ui/notes/gibt-es-nicht", json={"title": "x"}).status_code == 404

    removed = client.delete(f"/api/ui/notes/{note['id']}").get_json()["note"]
    assert removed["title"] == "Ben wegen Referat fragen"
    assert client.delete(f"/api/ui/notes/{note['id']}").status_code == 404
    assert [item[1] for item in listed()] == ["Lernkarten für Bio und Chemie"]
    assert client.delete(f"/api/ui/notes/{idea['id']}").status_code == 200

    # Two notes from the same second still come newest first.
    quick = [client.post("/api/ui/notes", json={"type": "note", "title": title}).get_json()["note"] for title in ("zuerst", "danach")]
    assert [item[1] for item in listed()] == ["danach", "zuerst"]
    for item in quick:
        assert client.delete(f"/api/ui/notes/{item['id']}").status_code == 200


def test_a_note_from_the_older_interface_without_a_title_shows_its_first_line(client):
    ui_data.modify_list("notes", lambda items: items.append({"id": "alt-1", "type": "note", "title": None, "content": "Sportzeug waschen\nbis Mittwoch\nund trocknen", "created_at": "2026-09-30T18:00:00"}))
    shown = page_data(client, "/hub/tasks")["page"]["notes"]
    assert [(item["id"], item["title"], item["details"]) for item in shown] == [("alt-1", "Sportzeug waschen", "bis Mittwoch\nund trocknen")]

    # Saving what the list shows keeps every line: the first one becomes the title, the rest stays the text.
    saved = client.patch("/api/ui/notes/alt-1", json={"title": shown[0]["title"], "details": shown[0]["details"], "type": "idea"}).get_json()["note"]
    assert (saved["type"], saved["title"], saved["details"]) == ("idea", "Sportzeug waschen", "bis Mittwoch\nund trocknen")
    stored = next(item for item in ui_data.load_list("notes") if item["id"] == "alt-1")
    assert (stored["title"], stored["content"]) == ("Sportzeug waschen", "bis Mittwoch\nund trocknen")
    assert client.delete("/api/ui/notes/alt-1").status_code == 200


@pytest.mark.parametrize("change, title, content", [
    ({"details": "bis Mittwoch\nund bügeln"}, "Sportzeug waschen", "bis Mittwoch\nund bügeln"),
    ({"title": "Sportzeug und Schuhe waschen"}, "Sportzeug und Schuhe waschen", "bis Mittwoch\nund trocknen"),
    ({"type": "idea"}, "Sportzeug waschen", "bis Mittwoch\nund trocknen"),
])
def test_changing_one_part_of_a_note_without_a_title_keeps_the_other(client, change, title, content):
    ui_data.modify_list("notes", lambda items: items.append({"id": "alt-3", "type": "note", "title": None, "content": "Sportzeug waschen\nbis Mittwoch\nund trocknen", "created_at": "2026-09-30T18:00:00"}))
    saved = client.patch("/api/ui/notes/alt-3", json=change).get_json()["note"]
    assert (saved["title"], saved["details"]) == (title, content)
    again = next(item for item in page_data(client, "/hub/tasks")["page"]["notes"] if item["id"] == "alt-3")
    assert (again["title"], again["details"]) == (title, content)
    assert client.delete("/api/ui/notes/alt-3").status_code == 200


def test_a_long_note_from_the_older_interface_is_not_cut_by_an_edit_or_an_undo(client):
    title, text = "Protokoll " + "sehr " * 70, "Zeile mit Umlauten äöü\n" * 400
    assert len(title) > 300 and len(text) > 5000
    ui_data.modify_list("notes", lambda items: items.append({"id": "alt-2", "type": "note", "title": title, "content": text, "created_at": "2026-09-30T18:00:00"}))
    shown = next(item for item in page_data(client, "/hub/tasks")["page"]["notes"] if item["id"] == "alt-2")
    assert (shown["title"], shown["details"]) == (title.strip(), text.strip())

    # The page sends only what changed. Even when it sends everything, as after a delete that is undone, nothing is cut.
    assert client.patch("/api/ui/notes/alt-2", json={"type": "idea"}).get_json()["note"]["details"] == text.strip()
    assert client.patch("/api/ui/notes/alt-2", json={"title": shown["title"], "details": shown["details"]}).get_json()["note"]["title"] == title.strip()
    assert client.delete("/api/ui/notes/alt-2").status_code == 200
    back = client.post("/api/ui/notes", json={"type": "idea", "title": shown["title"], "details": shown["details"], "created": shown["created"]}).get_json()["note"]
    assert (back["title"], back["details"], back["created"]) == (title.strip(), text.strip(), "2026-09-30T18:00:00")
    assert client.delete(f"/api/ui/notes/{back['id']}").status_code == 200


def test_the_source_of_the_assistant_can_be_chosen(client, tmp_path, monkeypatch):
    from app import assistant_service as ai

    monkeypatch.setattr(ai, "CONFIG_FILE", tmp_path / "assistant_config.json")
    monkeypatch.setattr(ai, "check_ollama_status", lambda: {"available": True, "models": ["gemma3:4b", "qwen2.5:14b"]})
    monkeypatch.setattr(ai, "check_local_status", lambda: {"available": True, "model": "Eingebaut"})
    monkeypatch.setattr(ai, "release_assistant_soon", lambda delay=0: None)
    start = client.get("/api/hub/assistant/config").get_json()
    assert (start["preferred_backend"], start["active"]["backend"], start["ollama_models"], start["ollama_running"]) == ("auto", "local", ["gemma3:4b", "qwen2.5:14b"], True)
    assert start["claude_api_key_set"] is False

    chosen = client.post("/api/hub/assistant/config", json={"preferred_backend": "ollama", "ollama_model": "gemma3:4b"}).get_json()
    assert (chosen["preferred_backend"], chosen["ollama_model"], chosen["active"]["backend"], chosen["active"]["model"]) == ("ollama", "gemma3:4b", "ollama", "gemma3:4b")
    missing = client.post("/api/hub/assistant/config", json={"ollama_model": "nicht-da:1b"}).get_json()
    assert missing["active"]["backend"] == "offline"
    assert client.post("/api/hub/assistant/config", json={"preferred_backend": "offline"}).get_json()["active"]["available"] is False

    assert client.post("/api/hub/assistant/config", json={"preferred_backend": "irgendwas"}).status_code == 400
    assert client.post("/api/hub/assistant/config", json={"ollama_model": "a b; rm"}).status_code == 400
    assert client.post("/api/hub/assistant/config", json={"claude_api_key": ["x"]}).status_code == 400
    assert client.post("/api/hub/assistant/config", json={}).status_code == 400

    keyed = client.post("/api/hub/assistant/config", json={"claude_api_key": "  sk-ant-test-0123456789abcdef  "}).get_json()
    assert keyed["claude_api_key_set"] is True and "0123456789" not in json.dumps(keyed)
    assert ai.load_config()["claude_api_key"] == "sk-ant-test-0123456789abcdef"
    assert client.post("/api/hub/assistant/config", json={"claude_api_key": ""}).get_json()["claude_api_key_set"] is False

