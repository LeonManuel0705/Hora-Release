# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import ast
import importlib.util
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def spec_constant(name):
    tree = ast.parse((ROOT / "server.spec").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == name for target in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError(f"{name} fehlt in server.spec")


def frozen_entry():
    spec = importlib.util.spec_from_file_location("desktop_entry", ROOT / "desktop_entry.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_frozen_backend_keeps_every_google_api_the_app_builds():
    used = set()
    for source in (ROOT / "app").glob("*.py"):
        for name, version in re.findall(r"\bbuild\(\s*['\"]([\w.]+)['\"]\s*,\s*['\"]([\w.]+)['\"]", source.read_text(encoding="utf-8")):
            used.add(f"{name}.{version}")
    assert used, "keine Google-API gefunden, das Muster passt nicht mehr"
    assert used <= set(spec_constant("GOOGLE_APIS"))


def test_the_frozen_entry_reads_the_env_file_before_the_app(tmp_path, monkeypatch):
    settings = tmp_path / ".env"
    settings.write_text("SECRET_KEY=from-the-env-file-0123456789abcdef0123\nGOOGLE_CLIENT_ID=from-file\n", encoding="utf-8")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.delenv("PYTHON_DOTENV_DISABLED", raising=False)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "already-set")
    monkeypatch.setenv("HUB_ENV_FILE", str(settings))
    frozen_entry().load_settings()
    assert os.environ["SECRET_KEY"] == "from-the-env-file-0123456789abcdef0123"
    assert os.environ["GOOGLE_CLIENT_ID"] == "already-set"


def test_the_frozen_entry_starts_without_an_env_file(tmp_path, monkeypatch):
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.setenv("HUB_ENV_FILE", str(tmp_path / "missing.env"))
    frozen_entry().load_settings()
    assert "SECRET_KEY" not in os.environ
    monkeypatch.delenv("HUB_ENV_FILE")
    frozen_entry().load_settings()
    assert "SECRET_KEY" not in os.environ
