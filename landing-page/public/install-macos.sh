#!/bin/bash
# Hora macOS Installer
# Usage: curl -sL https://hora-app.netlify.app/install-macos.sh | bash
#
# Loads the app, checks its checksum and puts it into /Applications. An older
# copy goes to the Trash, so it can be put back. Nothing in Documents/Hora,
# where the data lives, is touched.

set -e

APP_NAME="Hora"
ZIP_URL="https://hora-app.netlify.app/downloads/Hora-macOS.zip"
INSTALL_DIR="/Applications"
APP="$INSTALL_DIR/$APP_NAME.app"
STAGED="$INSTALL_DIR/.$APP_NAME-neu.app"
TMP_DIR=$(mktemp -d)

cleanup() {
    rm -rf "$TMP_DIR"
    if [ -e "$STAGED" ]; then rm -rf "$STAGED"; fi
}
trap cleanup EXIT

fail() {
    echo ""
    echo "  ✗ $1"
    echo ""
    exit 1
}

# Uses the Finder's Trash, so "Zurücklegen" works. /usr/bin/trash exists from
# macOS 15 on, the file manager call behind it on every older version.
move_to_trash() {
    if [ -x /usr/bin/trash ] && /usr/bin/trash "$1" 2>/dev/null && [ ! -e "$1" ]; then
        return 0
    fi
    osascript -l JavaScript -e 'function run(argv) {
        ObjC.import("Foundation");
        return $.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(argv[0]), null, null);
    }' "$1" >/dev/null 2>&1 || true
    [ ! -e "$1" ]
}

echo ""
echo "  ╔══════════════════════════════════╗"
echo "  ║      Hora Installer für macOS    ║"
echo "  ╚══════════════════════════════════╝"
echo ""

echo "  → Lade Hora herunter..."
curl -fsSL --retry 2 -o "$TMP_DIR/Hora-macOS.zip" "$ZIP_URL" \
    || fail "Der Download hat nicht geklappt. Prüf deine Internetverbindung und versuch es noch einmal."

# Verify checksum (update EXPECTED_SHA on each release)
EXPECTED_SHA="a2f65da6f8b4c0159a49961b2a7adb8f4cc2d0b58d822207f514a931a0007316"
ACTUAL_SHA=$(shasum -a 256 "$TMP_DIR/Hora-macOS.zip" | awk '{print $1}')
if [ "$EXPECTED_SHA" != "PLACEHOLDER_UPDATE_ON_RELEASE" ] && [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
    fail "Die Prüfsumme stimmt nicht. Die Datei ist unvollständig oder verändert, deshalb wurde nichts installiert."
fi

echo "  → Entpacke..."
unzip -q "$TMP_DIR/Hora-macOS.zip" -d "$TMP_DIR"
APP_PATH=$(find "$TMP_DIR" -name "*.app" -maxdepth 2 -type d | head -1)
[ -n "$APP_PATH" ] || fail "Im Download steckt keine App."

rm -rf "$STAGED"
mv "$APP_PATH" "$STAGED" 2>/dev/null \
    || fail "$INSTALL_DIR ist für dich gesperrt. Melde dich mit einem Admin-Konto an und versuch es noch einmal."

# A copy that keeps running would hold on to the port the new one needs. Only
# this user's processes are stopped; another account's could not be anyway.
ME="$(id -u)"
if pgrep -U "$ME" -f "^$APP/Contents/" >/dev/null 2>&1; then
    echo "  → Hora läuft noch und wird für das Update beendet..."
    pkill -TERM -U "$ME" -f "^$APP/Contents/" || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        pgrep -U "$ME" -f "^$APP/Contents/" >/dev/null 2>&1 || break
        sleep 1
    done
    if pgrep -U "$ME" -f "^$APP/Contents/" >/dev/null 2>&1; then
        fail "Hora lässt sich nicht beenden. Beende es selbst mit ⌘Q und starte das Skript noch einmal."
    fi
fi

KEPT=""
if [ -e "$APP" ]; then
    echo "  → Lege die bisherige Version in den Papierkorb..."
    move_to_trash "$APP" \
        || fail "Die bisherige Version ließ sich nicht in den Papierkorb legen. Leg $APP selbst hinein und starte das Skript noch einmal."
    KEPT="yes"
fi

echo "  → Installiere nach $INSTALL_DIR..."
mv "$STAGED" "$APP"

echo ""
echo "  ✓ Hora ist installiert."
if [ -n "$KEPT" ]; then
    echo "  → Die bisherige Version liegt im Papierkorb. Dort kannst du sie zurücklegen."
fi
echo "  → Deine Daten in Dokumente/Hora bleiben, wie sie sind."
echo "  → Hora wird jetzt geöffnet."
echo ""

open "$APP"
