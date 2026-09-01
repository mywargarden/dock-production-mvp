# Dock 0.3.4 tested artifact

Exact tested ZIP SHA-256: `1617cdafb739858fcf4c32441bf77457821f3d833e0ddac46f0c838a107718a7`.

Manifest version: `0.3.4`.

This artifact was produced from the uploaded 0.3.3 unpacked Chrome artifact by removing its non-runtime backup directory, bumping the manifest to 0.3.4, and changing `core/storage.js` so authenticated managed-workspace 401/403 responses clear cached managed state while transient non-auth failures preserve cache.

It passed the live QA B suspend -> deny -> reactivate -> restore test in Chrome.

Repository `dock-extension` is not yet byte-equivalent to this tested artifact. Do not treat repository extension version 0.2.4 as the tested RC until source/artifact convergence is completed.