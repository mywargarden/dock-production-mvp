# Dock 0.3.6 v11 — Accepted Artifact Identity

Status: **FROZEN CANDIDATE — source convergence proven; Release Control registration and final destructive 7 remain**

## Accepted executable artifact

- File: `dock-0.3.6-default-background-final-v11.zip`
- Manifest version: `0.3.6`
- Manifest format: Chrome Manifest V3
- Artifact size: `41,944,447` bytes
- Artifact SHA-256: `bd4286c8a9338f690878a9f30d0edbc59bb82ea8e373c1c2f649b0057259d203`
- Extracted file count: `66`
- JavaScript syntax check: PASS (`node --check` across all packaged `.js` files)

## Exact source identity

The accepted ZIP was transferred into GitHub through a one-time, fail-closed GitHub Actions convergence run. The runner independently downloaded the staged artifact, verified its SHA-256, manifest version, Manifest V3 format, 66-file count, absence of symlinks, and exact Git subtree before commit. It then pushed the result and re-fetched the remote branch to verify remote identity.

- Canonicalization branch: `canonicalize-dock-0-3-6-final`
- Source commit: `ac1fef046534eab9e3a1cc08eb74894178154595`
- Repository root tree at source commit: `67088ed3a1ac1859cdd4aff1815151ca9daa102e`
- `dock-extension` source tree: `d92360a241b27f2a5a4b0343ea398f26dbd945d4`
- Artifact SHA-256: `bd4286c8a9338f690878a9f30d0edbc59bb82ea8e373c1c2f649b0057259d203`
- SHA-256 of per-file content manifest: `e321def11cea840757c689e2122c72c5efd7a604ec1b9aef2105aa5745c5bb2b`

Independent GitHub API verification after the workflow confirmed that the remote branch resolves to source commit `ac1fef046534eab9e3a1cc08eb74894178154595` and that its `dock-extension` tree is exactly `d92360a241b27f2a5a4b0343ea398f26dbd945d4`.

Therefore the former blocker is closed:

`accepted v11 executable == canonical branch dock-extension source tree`

## Evidence boundary

This proves artifact/source identity. It does **not** inherit the destructive-test standing of Dock 0.3.4 and it does not itself prove live RC1 behavior, tenant isolation, persistence, recovery, or extension delivery under the exact v11 artifact.

## Required next proof

1. Register the exact artifact/source identity in Dock HQ Release Control through the intended authenticated owner path.
2. Freeze that release record before testing; do not edit the v11 bytes.
3. Run the final destructive 7 only against this exact artifact/source identity.
4. If any `dock-extension` file changes, treat the result as a new candidate and generate new artifact/source identities before continuing.
