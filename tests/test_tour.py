# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

from pathlib import Path

import pytest

from app import database as db


@pytest.fixture
def db_path(tmp_path, monkeypatch):
    path = tmp_path / "hub.db"
    monkeypatch.setattr(db, "DATABASE_PATH", str(path))
    db.init_db()
    return path


@pytest.fixture
def client(db_path):
    from app import app as app_module
    from app.app import app

    app.config["TESTING"] = True
    with app.test_client() as client:
        # A /hub visit no longer hands out the web session on its own; the token
        # establishes it once, exactly as a browser does.
        client.get(f"/hub?token={app_module.API_TOKEN}")
        yield client


def test_tour_state_starts_empty(db_path):
    assert db.get_tour_state() is None


def test_tour_state_is_saved(db_path):
    db.save_tour_state("skipped")
    assert db.get_tour_state() == "skipped"
    db.save_tour_state("done")
    assert db.get_tour_state() == "done"


def test_tour_state_keeps_the_theme(db_path):
    db.save_user_theme("light")
    db.save_tour_state("done")
    assert db.get_user_theme() == "light"
    assert db.get_tour_state() == "done"


def test_unknown_tour_state_is_rejected(db_path):
    with pytest.raises(ValueError):
        db.save_tour_state("halfway")


def test_has_hub_tasks(db_path):
    assert not db.has_hub_tasks()
    db.create_hub_task(title="Vokabeln lernen")
    assert db.has_hub_tasks()


def test_tour_api_round_trip(client):
    assert client.get("/api/hub/tour").get_json() == {"success": True, "state": None}
    response = client.post("/api/hub/tour", json={"state": "done"})
    assert response.status_code == 200
    assert client.get("/api/hub/tour").get_json()["state"] == "done"


def test_tour_api_rejects_unknown_states(client):
    response = client.post("/api/hub/tour", json={"state": "reset"})
    assert response.status_code == 400
    assert client.get("/api/hub/tour").get_json()["state"] is None


def test_tour_api_needs_the_session(db_path):
    from app.app import app

    with app.test_client() as anonymous:
        assert anonymous.post("/api/hub/tour", json={"state": "done"}).status_code == 401


def test_hub_starts_the_tour_only_for_new_users(client):
    assert b'data-tour-auto="1"' in client.get("/hub").data
    db.create_hub_task(title="Vokabeln lernen")
    assert b'data-tour-auto="0"' in client.get("/hub").data


def test_hub_stops_offering_the_tour_once_it_ran(client):
    client.post("/api/hub/tour", json={"state": "skipped"})
    assert b'data-tour-auto="0"' in client.get("/hub").data


TOUR = Path(__file__).resolve().parent.parent / "app" / "static" / "js" / "tour.js"


def tour_steps():
    steps = TOUR.read_text(encoding="utf-8").split("const STEPS = [", 1)[1].split("\n  ];", 1)[0]
    return {block.split("'", 1)[0]: block for block in steps.split("id: '")[1:]}


def test_the_tour_is_short_and_ends_in_the_setup():
    tour = TOUR.read_text(encoding="utf-8")
    steps = tour_steps()
    assert len(steps) == 9
    assert "skip:" in steps["sample"], "the step about the sample task only comes when there is one"
    assert "IServ" not in str(steps) and "Google" not in str(steps)
    assert "Stundenplan eintragen" in steps["bye"] and "function handOver()" in tour


def test_every_step_about_a_page_shows_that_page():
    steps = tour_steps()
    pages = {"home": "/hub", "tasks": "/hub/tasks", "task-new": "/hub/tasks", "task-done": "/hub/tasks", "school": "/hub/school", "sample": "/hub", "bye": "/hub"}
    for step, page in pages.items():
        assert f"page: '{page}'" in steps[step], step
    assert "page:" not in steps["hello"] and "page:" not in steps["nav"]


def test_keys_belong_to_the_page_again_once_the_tour_ends():
    tour = TOUR.read_text(encoding="utf-8")
    end = tour.split("async function end(state) {", 1)[1].split("\n  }\n", 1)[0]
    assert end.index("removeEventListener('keydown', onKey, true)") < end.index("await guide.setMode('bye')")
    go = tour.split("async function go(id, options) {", 1)[1].split("\n  }\n", 1)[0]
    assert go.lstrip().startswith("if (!run || run.ending) return;")
    assert "token !== run.token" not in go.replace("!run || token !== run.token", "")
