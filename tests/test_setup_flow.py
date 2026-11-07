# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re
import shutil
import subprocess
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from app import database as db
from app import ui_data
from app.crypto_utils import encrypt_file

ROOT = Path(__file__).resolve().parent.parent


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


def page_data(client, path="/hub"):
    html = client.get(path).get_data(as_text=True)
    return json.loads(re.search(r'<script type="application/json" id="appData">(.*?)</script>', html, re.S).group(1))


@pytest.mark.parametrize("check", ["setup_check.mjs", "setup_flow_check.mjs"])
def test_the_setup_logic_holds_up_under_node(check):
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    major = int(re.match(r"v(\d+)", subprocess.run([node, "--version"], capture_output=True, text=True).stdout).group(1))
    if major < 18:
        pytest.skip("node is too old")
    result = subprocess.run([node, str(ROOT / "tests" / "js" / check)], capture_output=True, text=True, timeout=180)
    assert result.returncode == 0, result.stdout + result.stderr


def test_someone_new_has_no_class_until_they_name_it(client):
    assert page_data(client)["user"] == {"state": "", "grade": None, "iserv": "desktop"}
    client.post("/api/hub/tour", json={"state": "done"})
    assert db.get_timetable_settings()["class_level"] == 10
    assert page_data(client)["user"]["grade"] is None
    assert page_data(client, "/hub/settings")["page"]["school"]["grade"] is None


def test_the_class_named_in_the_setup_counts_everywhere(client):
    assert client.put("/api/ui/store/app-settings", json={"school": {"grade": 12}}).status_code == 200
    data = page_data(client, "/hub/settings")
    assert data["user"]["grade"] == 12
    assert data["page"]["school"]["grade"] == 12
    assert data["page"]["school"]["semester"] in ("Q3", "Q4")
    assert db.get_timetable_settings()["grade_system"] == "points"


def test_an_explicit_class_ten_is_kept(client):
    client.put("/api/ui/store/app-settings", json={"school": {"grade": 10}})
    assert page_data(client)["user"]["grade"] == 10


def test_a_class_set_in_the_older_screens_is_known():
    assert ui_data.known_grade({"class_level": 11}, {}) == 11
    assert ui_data.known_grade({"class_level": 10}, {}) is None
    assert ui_data.known_grade({"class_level": 10, "grade_system": "points"}, {}) is None
    assert ui_data.known_grade({"class_level": 10, "grade_system": "marks"}, {}) == 10
    assert ui_data.known_grade({}, {"app-settings": {"school": {"grade": True}}}) is None
    assert ui_data.known_grade({"class_level": 12}, {"app-settings": {"school": {"grade": 9}}}) == 9


def test_class_ten_saved_in_the_older_class_screen_counts(client):
    assert client.post("/api/hub/school/class-level", json={"class_level": 10}).status_code == 200
    assert page_data(client)["user"]["grade"] == 10
    assert page_data(client, "/hub/school")["page"]["semester"] in ("10/1", "10/2")


@pytest.fixture
def no_grades():
    ui_data.modify_list("grades", lambda items: items.clear())


def grade_page(client, day):
    return page_data(client, f"/hub/school?datum={day}&t=10:00")["page"]


def add_grade(client, semester, day, points):
    own = {"custom": True, "name": "Geografie", "short": "Geo", "hue": "moss", "type": "GK", "teacher": "", "room": ""}
    client.put("/api/ui/store/app-subjects", json={"items": {"geo-own": own}, "removed": []})
    return client.post("/api/ui/grades", json={"subject": "geo-own", "points": points, "type": "test", "semester": semester, "date": day}).get_json()["grade"]


def current(page):
    return [(item["id"], item["semester"]) for item in page["grades"]]


def test_a_grade_filed_under_the_guessed_class_ten_stays_current_and_takes_its_term_from_its_date(client, no_grades):
    old = add_grade(client, "10/1", "2026-09-20", 9)
    unknown = grade_page(client, "2026-11-10")
    assert (unknown["semester"], current(unknown), unknown["history"]) == ("", [(old["id"], "")], {})
    client.put("/api/ui/store/app-settings", json={"school": {"grade": 12}})
    assert current(grade_page(client, "2026-11-10")) == [(old["id"], "Q3")]
    february = grade_page(client, "2027-02-15")
    assert (february["semester"], current(february), february["history"]) == ("Q4", [], {"geo-own": {"Q3": 9}})
    stored = ui_data.load_list("grades")
    assert [item["semester"] for item in stored] == ["10/1"]


def test_a_grade_saved_without_a_class_keeps_the_term_of_its_date(client, no_grades):
    made = add_grade(client, grade_page(client, "2026-11-10")["semester"], "2026-11-10", 11)
    assert made["semester"] == ""
    assert current(grade_page(client, "2026-11-10")) == [(made["id"], "")]
    client.put("/api/ui/store/app-settings", json={"school": {"grade": 12}})
    assert current(grade_page(client, "2026-11-10")) == [(made["id"], "Q3")]
    assert grade_page(client, "2027-02-15")["history"] == {"geo-own": {"Q3": 11}}
    exported = client.get("/api/ui/export").get_json()["data"]["grades"]
    assert [(item["id"], item["semester"]) for item in exported] == [(made["id"], "Q3")]
    classic = client.get("/api/hub/school/grades").get_json()["grades"]
    assert [item["semester"] for item in classic] == ["Q3"]


def test_a_known_class_keeps_every_stored_term(client, no_grades):
    client.put("/api/ui/store/app-settings", json={"school": {"grade": 12}})
    kept = add_grade(client, "12/1", "2026-09-20", 10)
    page = grade_page(client, "2026-11-10")
    assert page["semester"] == "Q3"
    assert page["history"] == {"geo-own": {"12/1": 10}} and kept["semester"] == "12/1"


def test_grade_terms_follow_the_date_and_the_class_of_that_year():
    today = date(2026, 11, 10)
    assert ui_data.grade_term("Q1", date(2026, 9, 1), None, today) == "Q1"
    assert ui_data.grade_term("", date(2025, 10, 1), None, today) == "2025/26"
    assert ui_data.grade_term("10/2", date(2025, 3, 1), None, today) == "10/2"
    assert ui_data.grade_term("", date(2025, 10, 1), 12, today) == "Q1"
    assert ui_data.grade_term("10/1", date(2024, 10, 1), 12, today) == "10/1"
    assert ui_data.grade_term("10/1", date(2026, 3, 1), 12, today) == "Q2"
    assert ui_data.grade_term("10/1", date(2026, 3, 1), 10, today) == "10/1"
    assert ui_data.grade_term("10/2", date(2025, 3, 1), 11, today) == "10/2"


def test_the_bundesland_is_reported_once_chosen(client):
    db.save_bundesland_setting("BB")
    assert page_data(client)["user"]["state"] == "BB"


def test_a_new_plan_has_no_ab_weeks_until_answered(client):
    data = page_data(client)
    assert not any(data["timetable"][week][day] for week in "AB" for day in data["timetable"][week])
    html = client.get("/hub").get_data(as_text=True)
    assert '"app-ab-weeks"' not in re.search(r'id="appStore">(.*?)</script>', html, re.S).group(1)
    client.put("/api/ui/store/app-ab-weeks", json=False)
    assert db.get_timetable_settings()["has_ab_weeks"] == 0
    client.put("/api/ui/store/app-ab-weeks", json=True)
    assert db.get_timetable_settings()["has_ab_weeks"] == 1


def test_a_school_day_holds_twelve_periods_but_not_thirteen():
    base = [{"n": 1, "start": "08:00", "end": "09:30"}]
    twelve = [{"n": index + 1, "start": f"{7 + index:02d}:00", "end": f"{7 + index:02d}:45"} for index in range(12)]
    assert len(ui_data._block_times(base, {"v": 2, "blocks": twelve})) == 12
    thirteen = twelve + [{"n": 13, "start": "19:00", "end": "19:45"}]
    assert ui_data._block_times(base, {"v": 2, "blocks": thirteen}) == base


def write_weather(location, fetched, codes=True):
    today = fetched.date()
    tomorrow = today + timedelta(days=1)
    times = [f"{day.isoformat()}T{hour:02d}:00" for day in (today, tomorrow) for hour in range(24)]
    hourly = {"time": times, "temperature_2m": [10.0] * 48, "precipitation_probability": [0] * 48}
    if codes:
        hourly["weather_code"] = [61 if index == 15 else 3 for index in range(48)]
    encrypt_file({
        "location": location,
        "timestamp": fetched.isoformat(),
        "current": {"time": f"{today.isoformat()}T10:00", "wind_speed_10m": 9.0, "weather_code": 2},
        "daily": {"time": [today.isoformat(), tomorrow.isoformat()], "temperature_2m_max": [14.0, 12.0], "temperature_2m_min": [6.0, 5.0]},
        "hourly": hourly,
    }, ui_data.DATA_DIR / "weather_cache.json")


def test_the_forecast_carries_the_sky(monkeypatch):
    now = datetime.now()
    location = {"city": "Potsdam", "lat": 52.39, "lon": 13.06}
    write_weather(location, now)
    monkeypatch.setattr(ui_data, "refresh_weather_soon", lambda location: None)
    view = ui_data.weather({"location_json": json.dumps(location)}, now)
    assert view["code"] == 2
    assert view["hours"][15]["code"] == 61 and view["hours"][3]["code"] == 3
    assert view["tomorrowMorning"]["code"] == 3


def test_an_older_forecast_without_codes_invents_no_sky(monkeypatch):
    now = datetime.now()
    location = {"city": "Potsdam", "lat": 52.39, "lon": 13.06}
    write_weather(location, now, codes=False)
    monkeypatch.setattr(ui_data, "refresh_weather_soon", lambda location: None)
    view = ui_data.weather({"location_json": json.dumps(location)}, now)
    assert all("code" not in hour for hour in view["hours"])


def test_the_forecast_asks_for_the_hourly_sky(monkeypatch):
    seen = {}

    class Answer:
        def raise_for_status(self):
            return None

        def json(self):
            return {}

    def fake_get(url, params=None, timeout=None):
        seen.update(params or {})
        return Answer()

    import requests
    monkeypatch.setattr(requests, "get", fake_get)
    ui_data.refresh_weather({"city": "Potsdam", "lat": 52.4, "lon": 13.1})
    assert "weather_code" in seen["hourly"].split(",")


def test_every_page_can_open_the_setup(client):
    home = client.get("/hub").get_data(as_text=True)
    assert "/static/app/css/setup.css" in home
    main = (ROOT / "app" / "static" / "app" / "js" / "main.js").read_text(encoding="utf-8")
    assert re.search(r"^initSetup\(\);$", main, re.M)


def test_the_home_shows_the_weather_and_one_button_for_everything_new(client):
    home = client.get("/hub").get_data(as_text=True)
    assert 'id="headWeather"' in home and "data-open-weather" in home
    assert '<use href="#i-plus"/></svg>Neu' in home and "Notiz\n" not in home
    assert 'id="i-cloud-snow"' in home and 'id="i-cloud-lightning"' in home and 'id="i-cloud-fog"' in home


def test_the_plan_settings_offer_the_setup(client):
    settings = client.get("/hub/settings").get_data(as_text=True)
    assert settings.count('data-open-setup="settings"') == 2
