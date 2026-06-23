#!/usr/bin/env bash
# Repair the Electron binary on macOS after `npm install`.
#
# Why: with npm 11 + Electron's `extract-zip`, the postinstall fails to extract
# the macOS .app bundle (symlinks inside Frameworks/), leaving a ~256 KB stub and
# no path.txt, so `require('electron')` / `electron .` fail with
# "Electron failed to install correctly". The downloaded zip in
# ~/Library/Caches/electron is fine; only the extraction is broken.
#
# This re-extracts that cached zip with `ditto` (handles .app symlinks) and writes
# path.txt without a trailing newline. Run from the repo root: bash scripts/fix-electron-macos.sh
set -euo pipefail

ELECTRON_DIR="node_modules/electron"
[ -d "$ELECTRON_DIR" ] || { echo "node_modules/electron missing — run 'npm install' first." >&2; exit 1; }

ZIP=$(find "$HOME/Library/Caches/electron" -name 'electron-v*-darwin-*.zip' 2>/dev/null | head -1)
[ -n "${ZIP:-}" ] || { echo "No cached Electron zip found; deleting node_modules/electron and reinstalling..." >&2; rm -rf "$ELECTRON_DIR"; npm install electron; ZIP=$(find "$HOME/Library/Caches/electron" -name 'electron-v*-darwin-*.zip' | head -1); }

echo "Extracting $ZIP"
rm -rf "$ELECTRON_DIR/dist"
mkdir -p "$ELECTRON_DIR/dist"
ditto -x -k "$ZIP" "$ELECTRON_DIR/dist"
printf 'Electron.app/Contents/MacOS/Electron' > "$ELECTRON_DIR/path.txt"

echo "Electron repaired: $("$ELECTRON_DIR/dist/Electron.app/Contents/MacOS/Electron" --version)"
