#!/bin/bash
# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
#
# Freeze the Flask backend for the Mac app, so the app starts without a Python
# on the user's Mac. It reuses server.spec and requirements-desktop.txt from the
# Windows and Linux builds.
#
# The interpreter is a pinned and checksummed CPython from python-build-standalone.
# Its libraries run on macOS 11 and later. Homebrew's and Apple's Pythons are
# built for the macOS they came with, so a backend frozen from them would not
# start on older systems.
#
# Usage:  scripts/build_backend_macos.sh [arm64|x86_64]
# Output: build/freeze-macos-<arch>/dist/server/server
set -euo pipefail

ARCH="${1:-arm64}"
PYTHON_RELEASE="20261026"
PYTHON_VERSION="3.11.18"
PYINSTALLER_VERSION="6.22.3"

case "$ARCH" in
  arm64)
    TRIPLE="aarch64-apple-darwin"
    PYTHON_SHA256="f3e1cd83a7f1d70e58b0d69102c18bd6867d2f973068dc5cbfd5822e445c66df"
    MINIMUM_MACOS="11.0"
    ;;
  x86_64)
    TRIPLE="x86_64-apple-darwin"
    PYTHON_SHA256="d38edc2df25e7e7f886c802bf2fa552422b097c509dbdcbae828827470356095"
    MINIMUM_MACOS="10.15"
    ;;
  *)
    echo "usage: $0 [arm64|x86_64]" >&2
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WORK="$PROJECT_ROOT/build/freeze-macos-$ARCH"
CACHE="${XDG_CACHE_HOME:-$HOME/Library/Caches}/backend-freeze"
ARCHIVE_NAME="cpython-$PYTHON_VERSION+$PYTHON_RELEASE-$TRIPLE-install_only_stripped.tar.gz"
ARCHIVE="$CACHE/$ARCHIVE_NAME"
URL="https://github.com/astral-sh/python-build-standalone/releases/download/$PYTHON_RELEASE/${ARCHIVE_NAME/+/%2B}"

# An Intel build runs its tools under Rosetta, so pip picks x86_64 wheels.
run() {
  if [ "$ARCH" = "x86_64" ] && [ "$(uname -m)" != "x86_64" ]; then
    arch -x86_64 "$@"
  else
    "$@"
  fi
}

checksum_ok() {
  [ -f "$1" ] && [ "$(shasum -a 256 "$1" | awk '{print $1}')" = "$PYTHON_SHA256" ]
}

if ! checksum_ok "$ARCHIVE"; then
  echo "=== Downloading CPython $PYTHON_VERSION for $ARCH ==="
  mkdir -p "$CACHE"
  partial="$ARCHIVE.partial"
  curl -fsSL --retry 2 -o "$partial" "$URL"
  if ! checksum_ok "$partial"; then
    rm -f "$partial"
    echo "ERROR: the CPython download does not match its pinned checksum." >&2
    exit 1
  fi
  mv "$partial" "$ARCHIVE"
fi

echo "=== Preparing a clean build environment in $WORK ==="
rm -rf "$WORK"
mkdir -p "$WORK"
tar -xzf "$ARCHIVE" -C "$WORK"
run "$WORK/python/bin/python3" -m venv "$WORK/venv"
# protobuf 7 tags its macOS wheel for 10.9 but builds its extension for macOS
# 12, and no other build of it exists; 6.33 still runs on macOS 10.9.
run "$WORK/venv/bin/python" -m pip install --quiet --disable-pip-version-check \
  -r "$PROJECT_ROOT/requirements-desktop.txt" "pyinstaller==$PYINSTALLER_VERSION" "protobuf<7"

# pip picks wheels for the macOS of the build machine, and some are built for a
# newer one (numpy links Accelerate from macOS 14 on). Those are swapped for
# the build of the same version that runs on MINIMUM_MACOS.
CHECK="$PROJECT_ROOT/scripts/check_macos_minimum.py"
PLATFORM_TAG="macosx_${MINIMUM_MACOS/./_}_$ARCH"
SITE="$(run "$WORK/venv/bin/python" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
for requirement in $("$WORK/python/bin/python3" -I "$CHECK" --packages "$SITE" "$MINIMUM_MACOS"); do
  echo "=== Replacing $requirement with its build for macOS $MINIMUM_MACOS ==="
  run "$WORK/venv/bin/python" -m pip install --quiet --disable-pip-version-check --no-deps --upgrade \
    --only-binary=:all: --platform "$PLATFORM_TAG" --target "$SITE" "$requirement"
done

echo "=== Freezing the backend for $ARCH ==="
cd "$PROJECT_ROOT"
run "$WORK/venv/bin/python" -m PyInstaller server.spec --noconfirm --clean \
  --distpath "$WORK/dist" --workpath "$WORK/work"

SERVER="$WORK/dist/server/server"
if [ ! -x "$SERVER" ]; then
  echo "ERROR: the frozen server is missing at $SERVER" >&2
  exit 1
fi
if [ "$(lipo -archs "$SERVER")" != "$ARCH" ]; then
  echo "ERROR: $SERVER was built for $(lipo -archs "$SERVER"), not $ARCH" >&2
  exit 1
fi
if ! "$WORK/python/bin/python3" -I "$CHECK" "$WORK/dist/server" "$MINIMUM_MACOS"; then
  echo "ERROR: parts of the frozen server need a newer macOS than $MINIMUM_MACOS" >&2
  exit 1
fi
echo "=== Done: $SERVER ($(du -sh "$WORK/dist/server" | cut -f1)) ==="
