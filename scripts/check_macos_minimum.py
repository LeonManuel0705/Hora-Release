#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Find Mach-O files that need a newer macOS than the frozen backend promises.

    check_macos_minimum.py FOLDER VERSION
        Lists every file under FOLDER that needs more than macOS VERSION and
        exits with 1 if there is one.

    check_macos_minimum.py --packages SITE_PACKAGES VERSION
        Prints name==version for each installed distribution that ships such a
        file, so the build can swap it for the build of the same version that
        runs on the older macOS.

Only the standard library is used, so any Python can run it.
"""

import os
import struct
import sys
from pathlib import Path

LC_VERSION_MIN_MACOSX = 0x24
LC_BUILD_VERSION = 0x32
PLATFORM_MACOS = 1
THIN = {0xFEEDFACF: 32, 0xFEEDFACE: 28}
FAT = {0xCAFEBABE: 20, 0xCAFEBABF: 32}


def _version(packed):
    return (packed >> 16, (packed >> 8) & 0xFF)


def _slice_minimum(handle, offset):
    handle.seek(offset)
    header = handle.read(32)
    if len(header) < 28:
        return None
    magic = struct.unpack_from("<I", header)[0]
    if magic not in THIN:
        return None
    count, size = struct.unpack_from("<II", header, 16)
    handle.seek(offset + THIN[magic])
    commands = handle.read(size)
    position = 0
    for _ in range(count):
        if position + 8 > len(commands):
            break
        command, length = struct.unpack_from("<II", commands, position)
        if command == LC_BUILD_VERSION and position + 16 <= len(commands):
            platform, minimum = struct.unpack_from("<II", commands, position + 8)
            if platform == PLATFORM_MACOS:
                return _version(minimum)
        elif command == LC_VERSION_MIN_MACOSX and position + 12 <= len(commands):
            return _version(struct.unpack_from("<I", commands, position + 8)[0])
        if length < 8:
            break
        position += length
    return None


def minimums(path):
    """The macOS each slice of a Mach-O file needs; empty for any other file."""
    try:
        with open(path, "rb") as handle:
            head = handle.read(8)
            if len(head) < 8:
                return []
            big = struct.unpack_from(">I", head)[0]
            if big in FAT:
                count = struct.unpack_from(">I", head, 4)[0]
                if count > 32:
                    return []
                table = handle.read(count * FAT[big])
                offsets = []
                for index in range(count):
                    entry = table[index * FAT[big]:(index + 1) * FAT[big]]
                    if len(entry) < FAT[big]:
                        return []
                    offsets.append(struct.unpack_from(">Q" if big == 0xCAFEBABF else ">I", entry, 8)[0])
            elif struct.unpack_from("<I", head)[0] in THIN:
                offsets = [0]
            else:
                return []
            return [found for found in (_slice_minimum(handle, offset) for offset in offsets) if found]
    except OSError:
        return []


def too_new(path, wanted):
    return max(minimums(path), default=(0, 0)) > wanted


def files(folder):
    for root, _folders, names in os.walk(folder, followlinks=False):
        for name in names:
            path = Path(root) / name
            if not path.is_symlink():
                yield path


def distributions(site):
    for info in sorted(Path(site).glob("*.dist-info")):
        fields = {}
        for line in (info / "METADATA").read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.strip():
                break
            key, _, value = line.partition(":")
            fields.setdefault(key.strip().lower(), value.strip())
        record = info / "RECORD"
        listed = []
        if record.exists():
            listed = [line.split(",")[0] for line in record.read_text(encoding="utf-8").splitlines() if line]
        yield fields.get("name"), fields.get("version"), [Path(site) / entry for entry in listed]


def main(arguments):
    packages = arguments[:1] == ["--packages"]
    if packages:
        arguments = arguments[1:]
    if len(arguments) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    folder, wanted = arguments[0], tuple(int(part) for part in arguments[1].split(".")[:2])
    if packages:
        for name, version, listed in distributions(folder):
            if name and version and any(path.is_file() and not path.is_symlink() and too_new(path, wanted) for path in listed):
                print(f"{name}=={version}")
        return 0
    offenders = [(path, max(minimums(path))) for path in files(folder) if too_new(path, wanted)]
    for path, (major, minor) in offenders:
        print(f"{path.relative_to(folder)} needs macOS {major}.{minor}")
    return 1 if offenders else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
