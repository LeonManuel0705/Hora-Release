# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import json
import re
import shutil
import subprocess
from datetime import date
from pathlib import Path

import pytest

from app import database as db
from app import ui_data

ROOT = Path(__file__).resolve().parent.parent
CASES = json.loads((ROOT / 'tests' / 'ab_weeks.json').read_text(encoding='utf-8'))['cases']


@pytest.mark.parametrize('case', CASES, ids=lambda case: f"{case['reference']}:{case['day']}")
def test_weeks_alternate_from_the_reference_monday(case):
    assert ui_data.week_type(date.fromisoformat(case['day']), case['reference'], True) == case['week']


def test_with_ab_weeks_off_every_week_is_an_a_week():
    assert {ui_data.week_type(date.fromisoformat(case['day']), case['reference'], False) for case in CASES} == {'A'}


def test_the_grid_covers_the_edges_of_the_rule():
    days = [date.fromisoformat(case['day']) for case in CASES]
    assert any(day.weekday() == 6 for day in days)
    assert any(day.isocalendar()[1] == 53 for day in days)
    assert any(day < date.fromisoformat(case['reference']) for day, case in zip(days, CASES))
    assert len({day.year for day in days}) >= 5
    assert any(date.fromisoformat(case['reference']).weekday() != 0 for case in CASES)


def test_the_desktop_keeps_its_reference(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DATABASE_PATH', str(tmp_path / 'hub.db'))
    db.init_db()
    assert ui_data.school_setup({})['abReference'] == ui_data.DEFAULT_REFERENCE == '2026-01-12'
    assert ui_data.school_setup({'reference_date': '2026-09-07'})['abReference'] == '2026-09-07'
    assert ui_data.week_type(date(2026, 11, 6), ui_data.DEFAULT_REFERENCE, True) == 'A'


def test_the_phone_counts_from_the_same_monday():
    provider = (ROOT / 'flutter_app' / 'lib' / 'providers' / 'app_provider.dart').read_text(encoding='utf-8')
    year, month, day = map(int, ui_data.DEFAULT_REFERENCE.split('-'))
    assert f'static final abReference = DateTime.utc({year}, {month}, {day});' in provider


def test_the_page_counts_the_weeks_like_the_desktop_under_node():
    node = shutil.which('node')
    if not node:
        pytest.skip('node is not installed')
    major = int(re.match(r'v(\d+)', subprocess.run([node, '--version'], capture_output=True, text=True).stdout).group(1))
    if major < 18:
        pytest.skip('node is too old')
    result = subprocess.run([node, str(ROOT / 'tests' / 'js' / 'week_check.mjs')], capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr
