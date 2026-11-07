# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import threading
import time as real_time

import pytest

from app import calendar_cache
from app import google_oauth
from tests.test_calendar_cache import client, day, google, titles  # noqa: F401


class Clocks:
    """The two clocks the loop reads. While the computer sleeps only the wall clock moves on."""

    def __init__(self):
        self.wall = 1_800_000_000.0
        self.steady = 1000.0

    def time(self):
        return self.wall

    def monotonic(self):
        return self.steady

    def pass_by(self, seconds, asleep=False):
        self.wall += seconds
        if not asleep:
            self.steady += seconds


@pytest.fixture
def clocks(monkeypatch):
    fake = Clocks()
    monkeypatch.setattr(calendar_cache, 'time', fake)
    return fake


def checks(google):
    return google.count('calendarList.list') + sum(1 for name, details in google.calls if name == 'events.list' and 'updatedMin' in details)


def test_the_loop_checks_at_once_and_then_every_five_minutes(google, clocks):
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    assert calendar_cache.background_round() is True
    assert titles() == ['Gym']
    google.calls.clear()
    clocks.pass_by(calendar_cache.PERIOD_SECONDS - 1)
    assert calendar_cache.background_round() is False and google.calls == []
    google.put('primary', 'Nachhilfe', day(2), '17:00', '18:00')
    clocks.pass_by(1)
    assert calendar_cache.background_round() is True
    assert titles() == ['Gym', 'Nachhilfe']
    assert google.count('calendarList.list') == 0, 'a regular check asks only for changes'


def test_a_page_in_front_brings_the_check_forward_but_not_within_a_minute(google, clocks):
    calendar_cache.background_round()
    google.calls.clear()
    calendar_cache.nudge()
    clocks.pass_by(30)
    assert calendar_cache.background_round() is False and google.calls == []
    calendar_cache.nudge()
    clocks.pass_by(calendar_cache.CHECK_SECONDS - 30)
    assert calendar_cache.background_round() is True and checks(google) == 1


def test_several_open_pages_make_one_check(google, clocks, client):
    calendar_cache.background_round()
    google.calls.clear()
    clocks.pass_by(calendar_cache.CHECK_SECONDS)
    for _ in range(5):
        assert client.post('/api/ui/google/nudge').get_json()['google'] == 'ok'
    assert calendar_cache._worker['wake'].is_set()
    calendar_cache._worker['wake'].clear()
    assert calendar_cache.background_round() is True
    assert calendar_cache.background_round() is False
    assert checks(google) == 1


def test_after_sleep_the_wall_clock_decides(google, clocks):
    calendar_cache.background_round()
    google.calls.clear()
    clocks.pass_by(3 * 3600, asleep=True)
    assert calendar_cache.background_round() is True and checks(google) >= 1


def test_a_wall_clock_set_back_does_not_stop_the_checks(google, clocks):
    calendar_cache.background_round()
    clocks.wall -= 3600
    assert calendar_cache.background_round() is True


def test_without_network_it_tries_sooner_with_a_growing_pause(google, clocks):
    google.offline = True
    assert calendar_cache.background_round() is True and calendar_cache._status['problem'] == 'offline'
    tried = []
    for second in range(1, 16 * 60):
        clocks.pass_by(1)
        if calendar_cache.background_round():
            tried.append(second)
    assert tried[:4] == [60, 180, 420, 720], 'one minute, then two, four and five'
    google.offline = False
    clocks.pass_by(calendar_cache.PERIOD_SECONDS)
    assert calendar_cache.background_round() is True and calendar_cache._status['problem'] is None
    clocks.pass_by(calendar_cache.RETRY_SECONDS)
    assert calendar_cache.background_round() is False


def test_an_expired_sign_in_is_not_tried_again(google, clocks, monkeypatch):
    asked = []
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {google.primary: {'token': 'x', 'expired': True}})
    monkeypatch.setattr(google_oauth, 'calendar_service', lambda account_email=None: asked.append(1) or (None, google.primary))
    for _ in range(20):
        calendar_cache.nudge()
        clocks.pass_by(calendar_cache.PERIOD_SECONDS)
        assert calendar_cache.background_round() is False
    assert asked == [] and google.calls == []
    assert calendar_cache.page_state()['google'] == 'login'


def test_a_sign_in_google_refuses_during_a_check_is_marked_expired_once(google, clocks, monkeypatch):
    tokens = {google.primary: {'token': 'x', 'refresh_token': 'r'}}
    monkeypatch.setattr(google_oauth, 'load_tokens', lambda: {key: dict(value) for key, value in tokens.items()})
    monkeypatch.setattr(google_oauth, 'save_tokens', lambda fresh: tokens.clear() or tokens.update(fresh) or True)

    class RefreshError(Exception):
        pass

    def refuse(details):
        raise RefreshError("('invalid_grant: Token has been expired or revoked.', {'error': 'invalid_grant'})")

    google.hooks['calendarList.list'] = refuse
    assert calendar_cache.background_round() is True
    assert tokens[google.primary]['expired'] is True
    google.calls.clear()
    clocks.pass_by(calendar_cache.PERIOD_SECONDS * 3)
    assert calendar_cache.background_round() is False and google.calls == []


class WatchedLock:
    """The sync lock, telling when someone starts to wait for it with a time limit, as a page does."""

    def __init__(self):
        self._lock = threading.Lock()
        self.waiting = threading.Event()

    def acquire(self, blocking=True, timeout=-1):
        if timeout != -1:
            self.waiting.set()
        return self._lock.acquire(blocking, timeout)

    def release(self):
        self._lock.release()

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *details):
        self.release()


def test_a_page_that_asks_joins_a_check_already_running(google, monkeypatch):
    lock = WatchedLock()
    monkeypatch.setattr(calendar_cache, '_sync_lock', lock)
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    entered, release = threading.Event(), threading.Event()

    def hold(details):
        entered.set()
        release.wait(5)

    google.hooks['calendarList.list'] = hold
    running = threading.Thread(target=calendar_cache.sync)
    running.start()
    assert entered.wait(5)
    google.hooks.clear()
    answers = []
    asking = threading.Thread(target=lambda: answers.append(calendar_cache.refresh()))
    asking.start()
    assert lock.waiting.wait(5), 'the page waits for the running check'
    release.set()
    running.join(5)
    asking.join(5)
    assert answers == [None]
    assert checks(google) == 1, 'the page took the result of the running check instead of asking Google again'
    assert titles() == ['Gym']


def test_a_page_never_waits_long_for_a_check_that_hangs(google, monkeypatch):
    monkeypatch.setattr(calendar_cache, 'REQUEST_WAIT', 0.2)
    calendar_cache.sync()
    calendar_cache._status['checked'] = None
    entered, release = threading.Event(), threading.Event()

    def hang(details):
        entered.set()
        release.wait(10)

    google.hooks['events.list'] = hang
    running = threading.Thread(target=calendar_cache.sync)
    running.start()
    assert entered.wait(5)
    began = real_time.monotonic()
    calendar_cache.refresh()
    assert real_time.monotonic() - began < 2
    release.set()
    running.join(5)


def test_pages_left_open_get_the_fresh_copy(google, client):
    calendar_cache.sync()
    google.put('primary', 'Nachhilfe', day(2), '17:00', '18:00')
    calendar_cache._status['checked'] = None
    calendar_cache.sync()
    payload = client.get('/api/ui/google/events').get_json()
    assert [event['title'] for event in payload['events']] == ['Nachhilfe']
    assert payload['google'] == 'ok' and payload['stand']


def test_the_thread_starts_with_the_app_and_stops_with_it(google, monkeypatch):
    monkeypatch.setattr(calendar_cache, 'TICK_SECONDS', 0.05)
    google.put('primary', 'Gym', day(1), '16:30', '18:00')
    thread = calendar_cache.start_background()
    try:
        assert calendar_cache.start_background() is thread
        deadline = real_time.monotonic() + 5
        while not titles() and real_time.monotonic() < deadline:
            real_time.sleep(0.05)
        assert titles() == ['Gym']
    finally:
        calendar_cache.stop_background()
    assert not thread.is_alive()
    assert not [item for item in threading.enumerate() if item.name == 'calendar-sync']


def test_importing_and_serving_the_app_starts_no_thread(client):
    client.get('/hub')
    client.post('/api/ui/google/nudge')
    assert not [item for item in threading.enumerate() if item.name == 'calendar-sync']


def test_the_app_still_goes_with_the_app_that_started_it_while_the_check_runs(tmp_path):
    import os
    import subprocess
    import sys
    from pathlib import Path

    script = (
        "import threading, time\n"
        "from app import local_ai\n"
        "from app.app import start_background_jobs\n"
        "local_ai.install_shutdown_hooks()\n"
        "start_background_jobs()\n"
        "print('ready', any(item.name == 'calendar-sync' for item in threading.enumerate()), flush=True)\n"
        "time.sleep(30)\n"
    )
    environment = dict(os.environ, HUB_EXIT_WITH_PARENT='1', HUB_DATA_DIR=str(tmp_path))
    child = subprocess.Popen([sys.executable, '-c', script], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             cwd=str(Path(__file__).resolve().parent.parent), env=environment)
    try:
        assert child.stdout.readline().strip() == b'ready True'
        child.stdin.close()
        assert child.wait(timeout=20) == 0
    finally:
        if child.poll() is None:
            child.kill()
