# Dock 1.0 RC1 — 6 -> 7 Execution Board

## 6 — Convergence build

### Completed
- [x] Frozen RC1 viability gate committed to the branch.
- [x] Owner workspace compare API exists.
- [x] Owner workspace restore API exists with reason + audit trail.
- [x] Added owner workspace history endpoint for RC1 recovery UI.
- [x] Real owner account lifecycle API exists with reason + explicit CONFIRM + audit.
- [x] Server-backed owner Activity API exists with pagination/search.
- [x] Structured owner Diagnostics API exists.
- [x] Theme archive/restore/version-restore APIs exist.
- [x] Added `/hq-rc1` convergence console exposing the launch-critical missing control loops:
  - real suspend/archive/reactivate
  - workspace history/compare/restore
  - theme lifecycle/version restore
  - structured diagnostics
  - paginated audit activity
- [x] Collapsed Vercel Git realization topology to one canonical consumer: `dock-production-mvp`; detached duplicate `dock-production-mvp-i4b2` and `dock-production-mvp-jywt` projects from the GitHub repository.
- [x] Verified `/hq-rc1` compiles and serves from the canonical production Vercel project with HTTP 200.
- [x] Verified representative owner and district-admin API routes fail closed to unauthenticated requests with HTTP 401 and `Missing bearer token`.

### Current convergence checkpoint — 2026-09-02

Observed evidence:
- Canonical Vercel project `dock-production-mvp` is READY in production.
- `/hq-rc1` and `/hq-rc1/districts` render from the canonical deployment.
- The current locally approved extension artifact is Dock `0.3.6`; its zip passes integrity checks and all JavaScript files pass `node --check`.
- Approved local extension artifact SHA-256: `818411d87c60f39aebc40ec6624430e532385e13250abb4c59b021cf9c9b22c5`.

BLOCKER before destructive 7:
- The approved Dock 0.3.6 extension artifact is not yet identical to the `dock-extension` tree on the canonical GitHub main branch. The approved theme/assets and latest default background therefore do not yet have one canonical source identity. Do not freeze RC1 until source, artifact, and release identity converge.

Evidence boundary:
- The HTTP 200/401 checks above prove deployment presence and unauthenticated fail-closed behavior only. They do not prove authenticated owner/admin authorization, tenant isolation, persistence, recovery, or downstream extension delivery.

### Next convergence work
- [ ] Converge the approved Dock 0.3.6 extension artifact into the canonical source/release identity without changing its approved behavior or visual design.
- [ ] Verify command -> effect -> evidence for account lifecycle in live QA.
- [ ] Verify workspace compare -> restore -> new live version -> audit in live QA.
- [ ] Verify theme archive/restore/version restore -> audit in live QA.
- [ ] Verify Activity pagination/search against real audit volume.
- [ ] Verify Diagnostics identity resolution and PASS/WARNING/FAIL output.
- [ ] Verify Owner Settings and Releases against the frozen launch kernel; change only if a blocker exists.
- [ ] Create/confirm permanent QA district, admin, regular user, theme, workspace, and license.
- [ ] Verify extension/config delivery from that QA district.
- [ ] Freeze exact RC1 commit + deployment + extension artifact hash.

## 7 — Ground-truth falsification
Do not begin destructive 7 until the exact RC1 artifact is frozen.

### Birth
- [ ] Create a fresh district entirely through intended interfaces.
- [ ] Configure domain, admin, license, branding/theme, workspace, user.
- [ ] Confirm the user's Dock resolves the correct district and published state.
- [ ] No SQL/manual database rescue.

### Operation
- [ ] District Admin can perform promised customer actions.
- [ ] Owner HQ can govern promised owner actions.
- [ ] User Dock consumes the resulting authoritative state.
- [ ] Every consequential command has evidence.

### Isolation
- [ ] District A cannot read District B.
- [ ] District A cannot mutate District B.
- [ ] District A cannot inherit District B config/theme/workspace.
- [ ] Unauthenticated access exposes no private tenant data.
- [ ] Owner-only APIs reject non-owner authenticated users.

### Persistence
- [ ] Refresh preserves authoritative state.
- [ ] Sign out/in preserves authoritative state.
- [ ] New session/browser preserves authoritative state.
- [ ] Deploy/restart does not corrupt tenant state.

### Recovery
- [ ] Break QA workspace deliberately.
- [ ] Diagnose the problem using intended controls.
- [ ] Restore a retained workspace snapshot.
- [ ] Confirm a new live version is created.
- [ ] Confirm extension/user state reflects the restored workspace.
- [ ] Confirm audit evidence exists.
- [ ] Exercise suspend/reactivate and theme recovery safely.

## Finding classification
Every 7 finding is exactly one of:
- PASS
- BLOCKER
- PARK

No new product scope is admitted during 7.

## Exit
When all launch-kernel tests pass and no BLOCKER remains, the frozen artifact has survived 7 and is ready for 8 integration/release judgment.
