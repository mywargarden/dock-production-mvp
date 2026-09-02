# Dock 0.3.6 v11 — Accepted Artifact Identity

Status: **FROZEN CANDIDATE — source convergence required before RC1 destructive 7**

## Accepted executable artifact

- File: `dock-0.3.6-default-background-final-v11.zip`
- Manifest version: `0.3.6`
- Manifest format: Chrome Manifest V3
- Artifact size: `41,944,447` bytes
- Artifact SHA-256: `bd4286c8a9338f690878a9f30d0edbc59bb82ea8e373c1c2f649b0057259d203`
- Extracted file count: `66`
- JavaScript syntax check: PASS (`node --check` across all packaged `.js` files)

## Extracted source identity

The accepted ZIP was extracted without modification and its complete 66-file content tree was hashed as Git blobs.

- Extracted Git tree SHA: `d92360a241b27f2a5a4b0343ea398f26dbd945d4`
- SHA-256 of per-file content manifest: `e321def11cea840757c689e2122c72c5efd7a604ec1b9aef2105aa5745c5bb2b`

These identifiers describe the accepted v11 bytes. They do **not** assert that the repository `dock-extension` directory has converged yet.

## Current blocker

At freeze time, `dock-extension/manifest.json` on canonical source still reports `0.2.4`, so:

`accepted v11 executable != canonical repository extension tree`

The branch `canonicalize-dock-0-3-6-final` exists specifically to remove that mismatch. Do not promote this artifact to RC1 preview/production and do not inherit prior 0.3.4 destructive-test evidence until the repository source tree is made byte-equivalent to the accepted 66-file v11 tree and independently verified.

## Required next proof

1. Replace the branch `dock-extension` directory with the exact 66-file extracted v11 tree.
2. Verify the branch `dock-extension` tree SHA equals `d92360a241b27f2a5a4b0343ea398f26dbd945d4`.
3. Record the resulting source commit SHA and source tree SHA in Dock HQ Release Control together with the artifact SHA/size above.
4. Run the final destructive 7 only against this exact frozen artifact.

If any file changes during convergence or testing, it becomes a new candidate artifact and must receive a new artifact SHA and source tree identity.