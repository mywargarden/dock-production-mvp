# Dock 1.0 RC1 — 6 -> 7 Execution Board

## 6 — Convergence build

### Completed
- [x] Frozen RC1 viability gate committed.
- [x] Owner workspace compare + restore + history controls exist with audit evidence.
- [x] Owner account lifecycle controls exist with confirmation and audit.
- [x] Server-backed Owner Activity and structured Diagnostics exist.
- [x] Theme archive/restore/version-restore controls exist.
- [x] Vercel Git topology is collapsed to one canonical project: `dock-production-mvp`.
- [x] Owner Release Control stores cryptographic artifact identity and source identity.
- [x] Release promotion is governed by dedicated preview/production transitions rather than free-form status selection.
- [x] Accepted Dock 0.3.6 v11 bytes are canonicalized into `main` without changing the extension subtree.
- [x] Owner saved the frozen release identity through the intended authenticated Owner path; persisted readback and audit evidence matched.

## Original frozen RC1 candidate — 2026-09-02

This boundary was valid when final 7 began. It is retained as provenance and MUST NOT be silently rewritten after later evidence.

- Version: `0.3.6`
- Accepted ZIP SHA-256: `bd4286c8a9338f690878a9f30d0edbc59bb82ea8e373c1c2f649b0057259d203`
- Artifact size: `41944447` bytes
- Original canonical `main` source commit: `e8f22d00707f1c216ee8c608a3a40f8150298b42`
- Exact `dock-extension` Git tree: `d92360a241b27f2a5a4b0343ea398f26dbd945d4`
- Original production deployment: `https://dock-production-hn2al8roj-anchor-technologies.vercel.app`
- Release record: `0.3.6`, channel `development`, status `draft`
- Build verified: true
- Migrations verified: true
- Managed-config verified: false
- Theme-runtime verified: false
- Preview approval: not granted
- Production approval: not granted

### Original final-7 contract

Pre-attack authoritative workspace state was v3 with exactly one `Gmail` tab at `https://mail.google.com/`.

Frozen prediction was:

`client(v3 Gmail) -> deliberate published break(v4) -> client(v4 break) -> intended diagnosis -> intended restore(v5) -> client(v5 Gmail)`

The exact-candidate client visibly consumed v3 Gmail before the attack, closing the prior missing-baseline defect. The District Admin then published BREAK and the exact client visibly consumed `RC1 BREAK TEST`.

## Final-7 interruption — BLOCKER discovered

During the destructive run, an independent District Admin branding probe exposed a real launch-kernel defect: selecting a District Dock background image did not populate Staff Preview and Save Draft persisted no background.

Independent state verification showed `district_background_url = null` and `draft_branding.district_background_url = null`, so this was not merely a visual-preview defect; the intended District Admin branding command failed before persistence.

Root cause:
- the legacy admin client rejected raw source images larger than 3 MB before its own resize/compression step;
- the client also did not explicitly guarantee its compressed result would remain below the server managed-asset ceiling of 1.5 MB.

Classification: **BLOCKER**. District-admin managed branding is inside the promised launch boundary.

The attack sequence also advanced the QA workspace beyond the frozen version contract because BREAK was published repeatedly. Current observed live state reached v6 BREAK. Therefore the old `v3 -> v4 -> v5` sequence is no longer an eligible final-7 pass path. It is retained as historical evidence only; redefining it after the fact would move the pass boundary.

## Realized blocker fix candidate

The managed-background preprocessing fix was merged to canonical `main` at:

- Source commit: `7509979f3b46f3810ba1fe6f4ef7a7abf4a5d49c`
- Production deployment: `https://dock-production-ajl7eg1cm-anchor-technologies.vercel.app`
- Vercel state: READY
- Exact Dock extension tree after merge: `d92360a241b27f2a5a4b0343ea398f26dbd945d4`

The extension artifact bytes were not changed by this fix. The accepted 0.3.6 ZIP SHA and extension subtree therefore retain their byte identity, but the whole-system source commit/deployment identity changed and the Owner release record must be updated through the intended authenticated Owner path before a new final candidate can be frozen.

The fix preprocesses image files client-side before the legacy handler, allows reasonable raw source files, emits WebP at the appropriate maximum dimension, and targets <=1.2 MB so the result is below the 1.5 MB server managed-asset ceiling.

### Proof still required before BLOCKER can become PASS

Do not infer success from code/build alone. The same intended District Admin UI must now establish:

`choose background -> Staff Preview visibly changes -> Save Draft -> managed URL persists -> reload preserves draft background`

If that succeeds, publish/delivery may then be tested deliberately under a newly frozen version contract. Backend/service-role inspection may verify the effect but may not substitute for the District Admin browser command.

## New candidate status

Not yet frozen.

Before restarting destructive recovery 7:
1. Prove the background fix through the authenticated District Admin UI.
2. Independently verify managed-asset persistence.
3. Update the 0.3.6 Owner release record to source commit `7509979f3b46f3810ba1fe6f4ef7a7abf4a5d49c` and its canonical READY production deployment through Owner Release Control.
4. Establish a fresh healthy live/client baseline through intended controls.
5. Freeze the new exact live version and a new break/restore prediction before the next attack.

## Finding classification
Every final-7 finding is exactly one of:
- PASS
- BLOCKER
- PARK

No new product scope is admitted during final 7.

## Exit
When the newly frozen candidate survives final 7 with no BLOCKER, managed-config and theme-runtime verification may be promoted from false to true only to the extent directly supported by the run. Preview approval may then be considered. Production approval remains a separate 8/release judgment.
