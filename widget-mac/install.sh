#!/usr/bin/env bash
# Build + (re)install the macOS "Home Wizard" widget locally.
#
# Requires: full Xcode + xcodegen (brew install xcodegen).
# Run from anywhere: bash widget-mac/install.sh
#
# It generates the Xcode project, builds with local signing (no Apple ID needed),
# copies the app to /Applications and launches it once to register the widget.
# Then add the tile: right-click desktop -> Edit Widgets -> "Home Wizard".
set -euo pipefail

# Make brew-installed tools (xcodegen) reachable in a non-login shell.
if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

command -v xcodegen >/dev/null || { echo "xcodegen missing — run: brew install xcodegen" >&2; exit 1; }
xcodebuild -version >/dev/null 2>&1 || { echo "Full Xcode required (xcodebuild not found)." >&2; exit 1; }

echo "▸ Generating project…"
xcodegen generate >/dev/null

echo "▸ Building (local signing)…"
rm -rf build
xcodebuild -project HomeWizardWidget.xcodeproj -scheme HomeWizardWidget -configuration Debug \
  -allowProvisioningUpdates -derivedDataPath build build >/dev/null

APP="build/Build/Products/Debug/HomeWizardWidget.app"
echo "▸ Installing to /Applications…"
osascript -e 'quit app "HomeWizardWidget"' 2>/dev/null || true
rm -rf "/Applications/HomeWizardWidget.app"
cp -R "$APP" /Applications/

echo "▸ Registering the widget…"
open "/Applications/HomeWizardWidget.app"
sleep 2
pluginkit -a "/Applications/HomeWizardWidget.app/Contents/PlugIns/HWMWidgetExtension.appex" 2>/dev/null || true

echo "✅ Installed. Add it: right-click the desktop → Edit Widgets → \"Home Wizard\"."
echo "   (Make sure HomeWizard Monitor is running so the widget has live data.)"
