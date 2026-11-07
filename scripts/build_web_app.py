#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Builds the web app for /pwa/ and writes the list of its files into the offline worker.

Without that list the worker keeps nothing for offline use, so publish only builds made here.
Arguments it does not know go to `flutter build web`. With --stamp DIR it only rewrites the
list of a build that already exists.
"""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / 'flutter_app'
WORKER = 'app_worker.js'
SLOT = re.compile(r'^const MANIFEST = .*;$', re.M)
LEFT_OUT = {'.last_build_id', WORKER, 'hub_worker.js', 'flutter_service_worker.js'}
LEFT_OUT_PREFIXES = ('canvaskit/chromium/', 'canvaskit/skwasm')
LEFT_OUT_SUFFIXES = ('.symbols', '.map')


def offline_files(out):
    files = {}
    for file in sorted(out.rglob('*')):
        name = file.relative_to(out).as_posix()
        if not file.is_file() or name in LEFT_OUT or name.startswith(LEFT_OUT_PREFIXES) or name.endswith(LEFT_OUT_SUFFIXES):
            continue
        files[name] = hashlib.sha256(file.read_bytes()).hexdigest()
    return files


def stamp(out):
    worker = out / WORKER
    source = worker.read_text(encoding='utf-8')
    if not SLOT.search(source):
        sys.exit(f'{worker} has no manifest line')
    files = offline_files(out)
    build = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()[:16]
    manifest = json.dumps({'build': build, 'files': files}, sort_keys=True, separators=(',', ':'))
    worker.write_bytes(SLOT.sub(lambda _: f'const MANIFEST = {manifest};', source, count=1).encode('utf-8'))
    size = sum((out / name).stat().st_size for name in files)
    print(f'{out}: build {build}, {len(files)} files, {size / 1e6:.1f} MB kept for offline use')
    return build


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--stamp', metavar='DIR', help='only rewrite the file list of an existing build')
    args, extra = parser.parse_known_args()
    if args.stamp:
        stamp(Path(args.stamp))
        return
    flutter = shutil.which('flutter')
    if not flutter:
        sys.exit('flutter is not on the PATH')
    command = [flutter, 'build', 'web', '--release', '--no-web-resources-cdn', '--base-href', '/pwa/', *extra]
    subprocess.run(command, cwd=APP, check=True)
    stamp(APP / 'build' / 'web')


if __name__ == '__main__':
    main()
