# Dock 1.0 RC1 — Frozen Viability Gate

Status: FROZEN for the Dock 1.0 RC1 cycle.
Branch: dock-hq-v4-1-functional

## Parent-cycle target
Produce one coherent, sellable Dock 1.0 release candidate.

## 5 — Viability question
Can a brand-new district be securely created, operated, observed, supported, and recovered using Dock's intended interfaces, without hidden database rescue and without crossing tenant or role boundaries?

## Frozen mechanism
Every critical loop must close:

Command -> Effect -> Evidence

A loop is viable only when:
1. The intended role can issue the command.
2. Unauthorized roles and other tenants cannot issue or inherit it.
3. The correct backend state changes.
4. The change persists across refresh/relogin.
5. The effect reaches the intended downstream experience.
6. The system records usable evidence (audit/version/diagnostic state).
7. Consequential changes have a sane recovery path.
8. Failure is explicit and does not silently corrupt state.

## Irreducible Dock 1.0 launch kernel
The following must survive 5:

- Owner authentication and owner-only HQ boundaries
- Tenant isolation
- District creation and editing
- Domain/admin identity resolution
- User eligibility and access control
- Licensing/seat enforcement sufficient for first customers
- Workspace save/publish and extension delivery
- Branding/theme persistence sufficient for the promised product
- Owner diagnostics/audit evidence sufficient to support customers
- Recovery of consequential workspace/customer state
- One canonical deployable build and working HQ/customer/user paths
- End-to-end birth test for a new district
- End-to-end break/recovery test in QA

## Known convergence work before destructive 5 testing
Close or verify the existing loops that are already known to be incomplete or visually behind backend capability:

- Real audited district account lifecycle actions
- Workspace compare/restore owner flow
- Theme lifecycle/history only to the extent required for safe operation/recovery
- Activity evidence path
- Structured diagnostics path
- Owner settings/release behavior required by the launch kernel
- Canonical Vercel deployment path
- Permanent QA district/user
- Fresh extension/config delivery test

## Explicitly not required to create RC1 unless testing proves otherwise
These are parked rather than allowed to reopen expansion:

- Theme Store
- Full Stripe automation
- Self-service signup
- Advanced customer-health scoring
- Global HQ search
- Fancy activity exports
- Advanced release/adoption polish
- Additional themes
- Nonessential notification automation
- Cosmetic redesigns

## 5 execution tests

### Birth
Create a new QA district from zero through intended interfaces: district -> domain -> admin -> license -> branding/theme -> workspace -> user -> Dock.

### Operation
Use the new district normally and verify command -> effect -> evidence across the promised product.

### Isolation
Prove District A cannot read, change, inherit, or resolve District B data. Prove unauthenticated access receives nothing private.

### Persistence
Refresh, sign out/in, reopen, and redeploy where appropriate. State remains authoritative and consistent.

### Recovery
Intentionally break QA state, diagnose it, restore it through intended controls, and return the customer to healthy operation.

## Decision rule
Every finding is classified only as:

- PASS — survives Dock 1.0 viability.
- BLOCKER — must be fixed before RC1.
- PARK — legitimate later work that does not prevent a secure/supportable sale.

5 is subtractive. It does not add product scope.

## Exit condition
5 closes when there is no unresolved BLOCKER against the launch kernel.
The surviving system becomes Dock 1.0 RC1 — the parent cycle's 6.
