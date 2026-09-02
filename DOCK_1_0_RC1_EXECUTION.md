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

## Frozen RC1 candidate — 2026-09-02

The claim boundary for final 7 is frozen here. Any later change to these values creates a new candidate and invalidates inheritance of this final-7 result.

- Version: `0.3.6`
- Accepted ZIP SHA-256: `bd4286c8a9338f690878a9f30d0edbc59bb82ea8e373c1c2f649b0057259d203`
- Artifact size: `41944447` bytes
- Canonical `main` source commit: `e8f22d00707f1c216ee8c608a3a40f8150298b42`
- Exact `dock-extension` Git tree: `d92360a241b27f2a5a4b0343ea398f26dbd945d4`
- Canonical production deployment: `https://dock-production-hn2al8roj-anchor-technologies.vercel.app`
- Release record: `0.3.6`, channel `development`, status `draft`
- Build verified: true
- Migrations verified: true
- Managed-config verified: false pending final 7
- Theme-runtime verified: false pending final 7
- Preview approval: not yet granted
- Production approval: not yet granted

### Frozen QA recovery target

Organization: `Dock RC1 QA` (`dock-rc1-qa`)

Pre-attack authoritative workspace state:
- Workspace: `Dock RC1 QA Dock`
- Live version: `3`
- Live tab set: exactly one tab — `Gmail` at `https://mail.google.com/`

Pre-attack access state:
- Primary verified domain: `rc1-qa.dock.test`
- Active district admin: `ria.agee13@gmail.com`
- Active allowed user: `qa-user@rc1-qa.dock.test`
- License: `trial`
- Plan: `district`
- Max users: `10`
- Default theme: `dock-green`
- Tenant not suspended or archived

## 7 — Ground-truth falsification

### Test-design lock

Final 7 must test the frozen candidate above. The pass condition may not be redefined after an attack begins.

For the destructive workspace recovery test, the client baseline MUST be observed before the break. The frozen prediction is:

`client(v3 Gmail) -> deliberate published break(v4) -> client(v4 break) -> intended diagnosis -> intended restore(v5) -> client(v5 Gmail)`

Required evidence:
1. Exact-candidate Dock client visibly consumes pre-break v3 Gmail state.
2. Break is created through intended district-admin controls, not SQL/service-role rescue.
3. Exact-candidate Dock visibly consumes the broken published state.
4. Owner intended diagnostics/compare path identifies the break.
5. Restore is issued through intended Owner restore control.
6. Restore creates a new live version rather than rewriting history.
7. Exact-candidate Dock visibly consumes the restored Gmail state.
8. Audit/version history preserves the break and restore evidence.

Falsifiers include:
- client fails to resolve `dock-rc1-qa` under an authorized identity;
- client does not consume the authoritative published workspace;
- break is not observable downstream;
- diagnosis cannot identify the actual change;
- restore mutates history instead of creating a new version;
- restored state does not reach the client;
- tenant/role boundaries can be crossed;
- consequential state changes lack usable evidence;
- recovery requires SQL/manual database rescue.

### Birth
- [x] Fresh RC1 QA district was created through intended interfaces and backend state matched the declared tenant birth contract.
- [x] Domain/admin/license/theme/workspace/user authority was established without SQL rescue.
- [x] Outside-domain district-admin bootstrap authority was corrected and observed resolving the RC1 QA workspace.

### Operation
- [x] District-admin and Owner command paths have been exercised in QA for published workspace and release control operations.
- [ ] Reconfirm exact 0.3.6 v11 client consumption under the frozen candidate before destructive attack.

### Isolation
- [x] Unauthenticated representative private routes fail closed.
- [x] Prior QA isolation/revocation checks established fail-closed behavior at their tested evidence boundary.
- [ ] Reconfirm no cross-tenant regression discovered during final exact-candidate run.

### Persistence
- [x] Authoritative QA workspace persisted through prior publish/restore/deploy cycles.
- [ ] Reconfirm exact-candidate client after refresh/reopen during final run.

### Recovery
- [ ] Observe exact-candidate client pre-break baseline: v3 Gmail.
- [ ] Deliberately publish v4 break through intended district-admin UI.
- [ ] Observe exact-candidate client consuming v4 break.
- [ ] Diagnose v4 vs retained healthy state through intended Owner controls.
- [ ] Restore retained healthy snapshot through intended Owner control, creating v5.
- [ ] Observe exact-candidate client consuming v5 Gmail.
- [ ] Independently verify version history and Owner audit evidence.

## Finding classification
Every final-7 finding is exactly one of:
- PASS
- BLOCKER
- PARK

No new product scope is admitted during final 7.

## Exit
When the frozen candidate survives final 7 with no BLOCKER, managed-config and theme-runtime verification may be promoted from false to true only to the extent directly supported by the run. Then preview approval may be considered. Production approval remains a separate 8/release judgment.
