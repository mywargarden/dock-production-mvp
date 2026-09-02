#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$ROOT_DIR/dock-extension"
OUT_DIR="${DOCK_APPLE_OUT_DIR:-$ROOT_DIR/DockAppleHost}"
APP_NAME="Dock"
BUNDLE_ID="${DOCK_APP_BUNDLE_ID:-com.anchor.dock.macos}"
DEVELOPMENT_TEAM="${DOCK_DEVELOPMENT_TEAM:-A4JT7VU8Q4}"

command -v xcrun >/dev/null 2>&1 || { echo "Xcode command line tools are required."; exit 1; }

PACKAGER=""
if xcrun --find safari-web-extension-packager >/dev/null 2>&1; then
  PACKAGER="safari-web-extension-packager"
elif xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  # Xcode versions before the current rename expose the same tool as converter.
  PACKAGER="safari-web-extension-converter"
else
  echo "Safari Web Extension packager is unavailable in this Xcode install."
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "Generating Dock Safari Web Extension from the current shared Dock 0.3.7 source..."
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

# Preserve the Apple Developer team recovered from the earlier Dock Safari build,
# while allowing an explicit override if the account/team changed.
python3 - "$PROJECT_FILE" "$DEVELOPMENT_TEAM" <<'PY'
from pathlib import Path
import re, sys
path = Path(sys.argv[1])
team = sys.argv[2].strip()
text = path.read_text()
if team:
    if 'DEVELOPMENT_TEAM =' in text:
        text = re.sub(r'DEVELOPMENT_TEAM = [^;]+;', f'DEVELOPMENT_TEAM = {team};', text)
    else:
        text = text.replace('CODE_SIGN_STYLE = Automatic;', f'CODE_SIGN_STYLE = Automatic;\n\t\t\t\tDEVELOPMENT_TEAM = {team};')
path.write_text(text)
PY

printf '\nGenerated Apple candidate at:\n  %s\n' "$OUT_DIR"
printf 'Bundle base: %s\nDeveloper team: %s\n' "$BUNDLE_ID" "$DEVELOPMENT_TEAM"
printf '\nOpen the generated .xcodeproj and run the Dock app target on macOS first.\nThen select an iPad simulator/device target and run the same project.\n'

open "$(find "$OUT_DIR" -name '*.xcodeproj' -print -quit)"
