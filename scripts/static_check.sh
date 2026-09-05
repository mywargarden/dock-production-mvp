#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-dock-extension}"
cd "$ROOT"

node <<'NODE'
const fs=require('fs');
const m=JSON.parse(fs.readFileSync('manifest.json','utf8'));
if(m.manifest_version!==3) throw new Error('Manifest V3 required');
if(!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(m.version)) throw new Error(`Invalid Chrome version ${m.version}`);
const worker=m.background?.service_worker;
if(!worker || !fs.existsSync(worker)) throw new Error('Missing active service worker');
if(m.action?.default_popup!=='popup.html') throw new Error('popup.html must remain toolbar popup');
if(m.chrome_url_overrides?.newtab!=='newtab.html') throw new Error('Dock New Tab override missing');
for(const p of ['storage','tabs','identity','scripting']) if(!m.permissions?.includes(p)) throw new Error(`Required permission missing: ${p}`);
const resources=(m.web_accessible_resources||[]).flatMap(x=>x.resources||[]);
for(const p of ['popup.html','assets/dock_boat_mark.png']) if(!resources.includes(p)) throw new Error(`Sidecar resource missing: ${p}`);
console.log(`Dock ${m.version} manifest: PASS`);
NODE

count=0
while IFS= read -r -d '' f; do
  node --check "$f" >/dev/null
  count=$((count+1))
done < <(find . -type f -name '*.js' -print0)
echo "JavaScript syntax: ${count} PASS"

node <<'NODE'
const fs=require('fs');
const must=[
 ['background-v3.js','import "./capture-hardening.js"'],
 ['background-v3.js','import "./background-v2.js"'],
 ['background-v3.js','REGISTER_DOCK_SIDECAR_TOKEN'],
 ['capture-hardening.js','LAUNCHER_CAPTURE_HIDE_CSS'],
 ['capture-hardening.js','DOCK_CAPTURE_SHIELD_UNVERIFIED'],
 ['capture-hardening.js','api.scripting.insertCSS'],
 ['capture-hardening.js','api.scripting.executeScript'],
 ['popup.html','capture-hardening.js'],
 ['dock-sidecar.js','if (open) { close({ restoreFocus: true }); return; }'],
 ['newtab.html','Let the currents take you, Dock guards the shore.'],
 ['popup.js','DOCK_SIDECAR_READY'],
 ['memories.css','object-fit: contain'],
 ['floating-dock.js','assets/dock_boat_mark.png'],
 ['floating-dock.js','Toggle Dock — drag to move'],
 ['floating-dock.js','POPUP_CLOSE_CLICK_GUARD_MS']
];
for(const [file,needle] of must){
  const s=fs.readFileSync(file,'utf8');
  if(!s.includes(needle)) throw new Error(`${file} missing release contract: ${needle}`);
}
const floating=fs.readFileSync('floating-dock.js','utf8');
if(/focusHidden\s*=/.test(floating)) throw new Error('floating launcher must not hide on page blur');
if(/dock_logo_clean\.png/.test(floating)) throw new Error('floating launcher regressed to full Dock logo');
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
if(manifest.background.service_worker!=='background-v3.js') throw new Error('background-v3 is not active');
NODE

for f in \
 'assets/crazy-ducky-theme.png' \
 'assets/dock-default-center copy.png' \
 'assets/dock-default-center.png' \
 'assets/dock-sunset.png' \
 'assets/dock_logo_lifted.png' \
 'assets/rubber-ducky-theme.png' \
 'assets/screenshot-unavailable.png' \
 'assets/tie-dye-bg.png'; do
  test ! -e "$f" || { echo "Dead release asset reintroduced: $f" >&2; exit 1; }
done

if find . -type f \( -name '*.zip' -o -name '*.DS_Store' -o -name '*.map' \) -print -quit | grep -q .; then
  echo 'Release debris detected' >&2
  exit 1
fi

if grep -RniE 'SUPABASE_SERVICE_ROLE|service_role_key|ghp_[A-Za-z0-9]+|github_pat_|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' --exclude-dir=assets .; then
  echo 'Potential secret material detected' >&2
  exit 1
fi

echo 'Dock release gate: PASS'
