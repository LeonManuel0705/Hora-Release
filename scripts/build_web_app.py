#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Builds the web app for /pwa/ and writes the list of its files into the offline worker.

  python3 scripts/build_web_app.py               build flutter_app/build/web and write the list
  python3 scripts/build_web_app.py --stamp DIR   only rewrite the list of an existing build
  python3 scripts/build_web_app.py --off DIR     turn the offline copy off on every device

A worker without the list refuses to install, so publish only builds made here.

To undo a bad publish, or to go back to a build without offline use, run --off on the folder you
publish next (any build, old or new) and publish it. On its next start each device removes the
worker and every offline copy and loads from the network again; a later normal build turns it
back on. Arguments the script does not know go to `flutter build web`.
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


def write_manifest(out, manifest):
    worker = out / WORKER
    source = worker.read_text(encoding='utf-8')
    if not SLOT.search(source):
        sys.exit(f'{worker} has no manifest line')
    line = f'const MANIFEST = {json.dumps(manifest, sort_keys=True, separators=(",", ":"))};'
    worker.write_bytes(SLOT.sub(lambda _: line, source, count=1).encode('utf-8'))


def stamp(out):
    files = offline_files(out)
    build = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()[:16]
    write_manifest(out, {'build': build, 'files': files})
    size = sum((out / name).stat().st_size for name in files)
    print(f'{out}: build {build}, {len(files)} files, {size / 1e6:.1f} MB kept for offline use')
    return build


def switch_off(out):
    write_manifest(out, 'off')
    print(f'{out}: the worker now removes itself and every offline copy on the next start of each device')


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0], epilog=__doc__.split('\n', 2)[2], formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--stamp', metavar='DIR', help='only rewrite the file list of an existing build')
    parser.add_argument('--off', metavar='DIR', help='make the worker of DIR remove itself and every offline copy')
    args, extra = parser.parse_known_args()
    if args.off:
        switch_off(Path(args.off))
        return
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
