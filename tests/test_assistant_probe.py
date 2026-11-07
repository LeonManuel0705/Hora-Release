# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import socket
import time

import pytest

from app import assistant_service as ai


@pytest.fixture(autouse=True)
def forget_status():
    ai._ollama_status.update(at=None, value=None)
    yield
    ai._ollama_status.update(at=None, value=None)


def test_ollama_is_asked_on_one_address_with_a_short_wait_for_the_connection():
    assert ai.OLLAMA_BASE == 'http://127.0.0.1:11434'
    connect, read = ai.OLLAMA_PROBE_TIMEOUT
    assert connect <= 0.2 and read >= 1


def test_the_answer_is_kept_for_a_few_seconds(monkeypatch):
    calls = []
    clock = [1000.0]
    monkeypatch.setattr(ai.time, 'monotonic', lambda: clock[0])
    monkeypatch.setattr(ai, '_probe_ollama', lambda: calls.append(1) or {'available': False, 'models': []})
    assert ai.check_ollama_status() == {'available': False, 'models': []}
    clock[0] += ai.OLLAMA_STATUS_TTL - 1
    ai.check_ollama_status()['models'].append('changed')
    assert ai.check_ollama_status() == {'available': False, 'models': []}
    assert len(calls) == 1
    clock[0] += 2
    ai.check_ollama_status()
    assert len(calls) == 2


def test_a_missing_ollama_costs_no_more_than_the_connect_wait(monkeypatch):
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        free = probe.getsockname()[1]
    monkeypatch.setattr(ai, 'OLLAMA_BASE', f'http://127.0.0.1:{free}')
    started = time.perf_counter()
    assert ai._probe_ollama() == {'available': False, 'models': []}
    assert time.perf_counter() - started < 1
