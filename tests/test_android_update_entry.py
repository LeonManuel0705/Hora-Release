# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "flutter_app" / "scripts" / "android_update_entry.py"


def load():
    spec = importlib.util.spec_from_file_location("android_update_entry", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_entry_names_the_release_file_with_its_size_and_checksum(tmp_path):
    apk = tmp_path / "app-release.apk"
    apk.write_bytes(bytes(range(256)) * 5000)
    version = tmp_path / "version.json"
    version.write_text(json.dumps({"version": "0.6.0", "platformUrls": {"android": "https://example.org/download#android"}}), encoding="utf-8")
    brand = json.loads((ROOT / "brand" / "brand.json").read_text(encoding="utf-8"))
    assert load().main([str(apk), "0.6.0", "--version-json", str(version)]) == 0
    written = json.loads(version.read_text(encoding="utf-8"))
    assert written["platformUrls"] == {"android": "https://example.org/download#android"}
    assert written["downloads"]["android"] == {
        "url": f"{brand['repository']}/releases/download/v0.6.0/{brand['name']}-0.6.0.apk",
        "size": 256 * 5000,
        "sha256": hashlib.sha256(apk.read_bytes()).hexdigest(),
    }


def test_a_version_json_of_another_release_is_left_alone(tmp_path):
    apk = tmp_path / "app-release.apk"
    apk.write_bytes(b"apk")
    version = tmp_path / "version.json"
    version.write_text(json.dumps({"version": "0.5.2"}), encoding="utf-8")
    assert load().main([str(apk), "0.6.0", "--version-json", str(version)]) == 1
    assert json.loads(version.read_text(encoding="utf-8")) == {"version": "0.5.2"}
