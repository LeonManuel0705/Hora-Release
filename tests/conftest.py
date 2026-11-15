# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import atexit
import os
import shutil
import sys
import tempfile
import threading
from pathlib import Path

import pytest

_TEST_ROOT = tempfile.mkdtemp(prefix="hub-tests-")
os.environ["HUB_DATA_DIR"] = str(Path(_TEST_ROOT) / "data")
# Tests and every backend they start keep accounts off, so none reaches the live account service.
os.environ["HORA_ACCOUNT_SERVICE"] = "off"
atexit.register(shutil.rmtree, _TEST_ROOT, True)


@pytest.fixture(autouse=True)
def secret_key(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-for-crypto-utils")


# Every test client calls from 127.0.0.1, so on a fast machine one route's 200 requests a minute would
# run out across tests and the next sign-in with the token would get 429 instead of a session.
@pytest.fixture(autouse=True)
def fresh_rate_limits():
    limiter = getattr(sys.modules.get('app.app'), 'limiter', None)
    if limiter is not None:
        limiter.reset()


@pytest.fixture(autouse=True)
def no_background_check_left_running():
    yield
    if not any(thread.name == 'calendar-sync' and thread.is_alive() for thread in threading.enumerate()):
        return
    sys.modules['app.calendar_cache'].stop_background()
    pytest.fail('a test left the background calendar check running')
