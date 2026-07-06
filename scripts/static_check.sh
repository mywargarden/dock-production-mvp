#!/usr/bin/env bash
set -euo pipefail
node --check dock-extension/core/auth.js
node --check dock-extension/core/storage.js
node --check dock-extension/background.js
node --check dock-extension/popup.js
node --check dock-extension/memories.js
./scripts/find_junk.sh
