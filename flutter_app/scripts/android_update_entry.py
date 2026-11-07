# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Writes the Android download of a release into the website's version.json.

Run it with the APK from the draft release once the version in version.json is the new one:
    python3 flutter_app/scripts/android_update_entry.py <apk> <version>
The phone app then loads that file itself, checks size and SHA-256 and starts the installer.
Without the entry it opens the download page as before.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def entry_for(apk: Path, version: str, brand: dict) -> dict:
    digest = hashlib.sha256()
    size = 0
    with apk.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
            size += len(chunk)
    return {
        "url": f"{brand['repository']}/releases/download/v{version}/{brand['name']}-{version}.apk",
        "size": size,
        "sha256": digest.hexdigest(),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("apk", type=Path)
    parser.add_argument("version")
    parser.add_argument("--version-json", type=Path, default=ROOT / "landing-page" / "public" / "version.json")
    parser.add_argument("--brand", type=Path, default=ROOT / "brand" / "brand.json")
    args = parser.parse_args(argv)
    info = json.loads(args.version_json.read_text(encoding="utf-8"))
    if info.get("version") != args.version:
        print(f"version.json is at {info.get('version')}, not {args.version}", file=sys.stderr)
        return 1
    entry = entry_for(args.apk, args.version, json.loads(args.brand.read_text(encoding="utf-8")))
    info.setdefault("downloads", {})["android"] = entry
    args.version_json.write_text(json.dumps(info, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(entry, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
