#!/usr/bin/env bash
set -euo pipefail

node --check dock-extension/core/personalScope.js
node --check dock-extension/core/auth.js
node --check dock-extension/core/license.js
node --check dock-extension/core/storage.js
node --check dock-extension/background-v2.js
node --check dock-extension/popup.js
node --check dock-extension/memories.js
node --check dock-extension/continuity-prepaint.js
node --check dock-extension/continuity.js

node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync("dock-extension/manifest.json","utf8")); if(m.version!=="0.3.12") throw new Error(`unexpected manifest version ${m.version}`); if(m.background?.service_worker!=="background-v2.js" || m.background?.type!=="module") throw new Error("canonical background worker not active"); if(!m.permissions?.includes("unlimitedStorage")) throw new Error("unlimitedStorage missing"); const exposed=(m.web_accessible_resources||[]).flatMap(x=>x.resources||[]); if(exposed.some(x=>x!=="import.html")) throw new Error(`unexpected web-accessible resource: ${exposed.join(",")}`);'

./scripts/find_junk.sh
