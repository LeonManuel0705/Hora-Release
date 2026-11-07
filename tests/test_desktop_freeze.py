# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import ast
import importlib.util
import os
import subprocess
import sys
import textwrap
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


def dotted(node):
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def google_builds(tree):
    """Calls that can reach googleapiclient.discovery.build.

    A bare build() counts unless the module defines its own build without
    importing Google's, so a call that forgot its import is still checked.
    """
    names = {"build"}
    modules = {"googleapiclient.discovery"}
    imported = False
    own = False
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "googleapiclient.discovery":
            for alias in node.names:
                if alias.name == "build":
                    names.add(alias.asname or "build")
                    imported = True
        elif isinstance(node, ast.ImportFrom) and node.module == "googleapiclient":
            modules.update(alias.asname or alias.name for alias in node.names if alias.name == "discovery")
        elif isinstance(node, ast.Import):
            modules.update(alias.asname for alias in node.names if alias.name == "googleapiclient.discovery" and alias.asname)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "build":
            own = True
    if own and not imported:
        names.discard("build")
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Name) and func.id in names:
            yield node
        elif isinstance(func, ast.Attribute) and func.attr == "build" and dotted(func.value) in modules:
            yield node


def api_of(call):
    if any(isinstance(arg, ast.Starred) for arg in call.args) or any(keyword.arg is None for keyword in call.keywords):
        return None
    given = dict(zip(("serviceName", "version"), call.args[:2]))
    given.update({keyword.arg: keyword.value for keyword in call.keywords if keyword.arg in ("serviceName", "version")})
    values = [given.get("serviceName"), given.get("version")]
    if not all(isinstance(value, ast.Constant) and isinstance(value.value, str) for value in values):
        return None
    return f"{values[0].value}.{values[1].value}"


def test_the_frozen_backend_keeps_every_google_api_the_app_builds():
    kept = set(spec_constant("GOOGLE_APIS"))
    used, unclear = set(), []
    for source in sorted((ROOT / "app").rglob("*.py")):
        for call in google_builds(ast.parse(source.read_text(encoding="utf-8"))):
            api = api_of(call)
            if api is None:
                unclear.append(f"{source.relative_to(ROOT)}:{call.lineno}")
            else:
                used.add(api)
    assert not unclear, "build() ohne festen Dienst und Version, server.spec kann es nicht prüfen: " + ", ".join(unclear)
    assert used, "keine Google-API gefunden, die Suche passt nicht mehr"
    assert used <= kept, f"in server.spec fehlen {sorted(used - kept)} in GOOGLE_APIS"


def test_the_frozen_entry_loads_the_env_file_before_the_app_is_imported():
    probe = textwrap.dedent(
        """
        import sys

        class Guard:
            def find_spec(self, name, path=None, target=None):
                if name == "app" or name.startswith("app."):
                    raise ImportError(f"{name} was imported before load_settings")

        guard = Guard()
        sys.meta_path.insert(0, guard)
        import desktop_entry

        def load_settings():
            sys.meta_path.remove(guard)
            print("load_settings first")
            raise SystemExit(0)

        desktop_entry.load_settings = load_settings
        desktop_entry.main()
        """
    )
    result = subprocess.run([sys.executable, "-c", probe], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.strip() == "load_settings first"


def test_the_frozen_entry_reads_the_env_file_without_overriding(tmp_path, monkeypatch):
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
