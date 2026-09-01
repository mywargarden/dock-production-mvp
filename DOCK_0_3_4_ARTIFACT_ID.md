# Dock 0.3.4 tested artifact

Exact tested ZIP SHA-256: `1617cdafb739858fcf4c32441bf77457821f3d833e0ddac46f0c838a107718a7`.

Manifest version observed in the tested runtime: `0.3.4`.

## Established

- The tested Chrome runtime passed the live QA B suspend -> deny -> reactivate -> restore test.
- The revocation change is in `core/storage.js`: authenticated managed-workspace 401/403 responses clear cached managed state while transient non-auth failures preserve cache.
- A recovered `dock-0.3.4-revocation-patch` contains `manifest.json`, `core/storage.js`, and `README.txt`.
- That patch README instructs replacing exactly `manifest.json` and `core/storage.js` in the currently loaded unpacked folder and names `~/Desktop/dock-extension-v0.3.2-license-gate-chrome-store-upload` as its target so the Chrome extension ID and local storage survive the regression test.
- A separate 0.3.3 HCPS release-candidate package exists with its own frozen checksums and release instructions.

## Unresolved lineage

Earlier documentation stated that the exact tested ZIP was produced from an uploaded 0.3.3 unpacked artifact. The recovered patch README instead identifies the live patch target as the loaded 0.3.2 license-gate folder. Those statements are not equivalent, and filenames/instructions alone cannot prove which complete parent bytes are represented by the frozen tested ZIP hash.

Therefore the parent lineage is **unresolved pending byte-level inspection of the surviving loaded extension folder and/or the exact tested ZIP**. Do not promote either the 0.3.2-parent or 0.3.3-parent story to established fact until hashes/file comparison resolve the conflict.

Repository `dock-extension` is not yet byte-equivalent to the tested artifact: its canonical manifest still reports `0.2.4`. Do not treat repository `dock-extension` as the tested RC until source/artifact convergence is completed.
