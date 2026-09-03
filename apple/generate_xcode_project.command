#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$ROOT_DIR/dock-extension"
OUT_DIR="${DOCK_APPLE_OUT_DIR:-$ROOT_DIR/DockAppleHost}"
APP_NAME="Dock"
BUNDLE_ID="${DOCK_APP_BUNDLE_ID:-com.anchor.dock.macos}"
DEVELOPMENT_TEAM="${DOCK_DEVELOPMENT_TEAM:-A4JT7VU8Q4}"
DOCK_VERSION="${DOCK_APPLE_VERSION:-0.3.9}"
DOCK_BUILD_NUMBER="${DOCK_APPLE_BUILD_NUMBER:-39}"

command -v xcrun >/dev/null 2>&1 || { echo "Xcode command line tools are required."; exit 1; }

PACKAGER=""
if xcrun --find safari-web-extension-packager >/dev/null 2>&1; then
  PACKAGER="safari-web-extension-packager"
elif xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  PACKAGER="safari-web-extension-converter"
else
  echo "Safari Web Extension packager is unavailable in this Xcode install."
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "Generating Dock Safari Web Extension from the current shared Dock ${DOCK_VERSION} source..."
echo "Using: xcrun $PACKAGER"
xcrun "$PACKAGER" "$EXT_DIR" \
  --project-location "$OUT_DIR" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --swift

PROJECT_FILE="$(find "$OUT_DIR" -name project.pbxproj -print -quit)"
HANDLER_FILE="$(find "$OUT_DIR" -name SafariWebExtensionHandler.swift -print -quit)"

if [ -z "$PROJECT_FILE" ] || [ -z "$HANDLER_FILE" ]; then
  echo "Generated project is missing expected Safari extension files."
  exit 1
fi

cp "$ROOT_DIR/apple/SafariWebExtensionHandler.swift" "$HANDLER_FILE"

# The Safari packager's native macOS host window is only an extension-enablement
# shell. Make it behave like a normal Mac window every time the Xcode project is
# regenerated: working close/minimize controls, while closing the shell does not
# terminate Dock's extension host process.
python3 "$ROOT_DIR/apple/patch_mac_host_window.py" "$OUT_DIR"

python3 - "$PROJECT_FILE" "$DEVELOPMENT_TEAM" "$DOCK_VERSION" "$DOCK_BUILD_NUMBER" <<'PY'
from pathlib import Path
import re, sys
path = Path(sys.argv[1])
team = sys.argv[2].strip()
version = sys.argv[3].strip()
build = sys.argv[4].strip()
text = path.read_text()

if team:
    if 'DEVELOPMENT_TEAM =' in text:
        text = re.sub(r'DEVELOPMENT_TEAM = [^;]+;', f'DEVELOPMENT_TEAM = {team};', text)
    else:
        text = text.replace('CODE_SIGN_STYLE = Automatic;', f'CODE_SIGN_STYLE = Automatic;\n\t\t\t\tDEVELOPMENT_TEAM = {team};')

if 'MARKETING_VERSION =' in text:
    text = re.sub(r'MARKETING_VERSION = [^;]+;', f'MARKETING_VERSION = {version};', text)
else:
    text = text.replace('CODE_SIGN_STYLE = Automatic;', f'CODE_SIGN_STYLE = Automatic;\n\t\t\t\tMARKETING_VERSION = {version};')

if 'CURRENT_PROJECT_VERSION =' in text:
    text = re.sub(r'CURRENT_PROJECT_VERSION = [^;]+;', f'CURRENT_PROJECT_VERSION = {build};', text)
else:
    text = text.replace('CODE_SIGN_STYLE = Automatic;', f'CODE_SIGN_STYLE = Automatic;\n\t\t\t\tCURRENT_PROJECT_VERSION = {build};')

text = re.sub(r'INFOPLIST_KEY_CFBundleShortVersionString = [^;]+;', f'INFOPLIST_KEY_CFBundleShortVersionString = {version};', text)
text = re.sub(r'INFOPLIST_KEY_CFBundleVersion = [^;]+;', f'INFOPLIST_KEY_CFBundleVersion = {build};', text)

path.write_text(text)
PY

printf '\nGenerated Apple candidate at:\n  %s\n' "$OUT_DIR"
printf 'Bundle base: %s\nDeveloper team: %s\nDock version: %s (%s)\n' "$BUNDLE_ID" "$DEVELOPMENT_TEAM" "$DOCK_VERSION" "$DOCK_BUILD_NUMBER"
printf 'macOS host window: close/minimize controls enabled; closing window keeps Dock host alive.\n'
printf '\nOpen the generated .xcodeproj and run the Dock app target on macOS first.\nThen select an iPad simulator/device target and run the same project.\n'

open "$(find "$OUT_DIR" -name '*.xcodeproj' -print -quit)"
