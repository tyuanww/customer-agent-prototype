---
name: authorization-reachability
description: Exhaustively check that no sequence of grant lifecycle operations can leave a child grant authorized under a revoked parent, or make the two decision functions disagree. Use when changing `changeGrant`, `createGrants`, `grant_parent_guard`, `authorization_sources`, `authorization_deadline`, `content_intake.role_ceiling`, or migrations 0055/0057.
---

# No operation sequence may resurrect authority

Two promises this repository makes, checked in **every reachable state** of the grant
lifecycle rather than in the cases somebody thought to write:

**P1.** A business grant that came from a parent never authorizes while that parent is revoked,
and never authorizes without a steward. *Harm if broken:* an operator revokes a delegation,
the UI confirms it, and the holder keeps publishing.

**P2.** At every reachable state, `authorization_sources` and `authorization_deadline` answer
the same yes/no for the same principal, action, scope and source. *Harm if broken:* one door
serves a source another door refuses, so the same person sees a script in one window and
"没有权限" in the next.

The whole bug class this guards lives in **sequences**, not single calls. Two real defects in
this area were exactly that shape: an early `return` in `changeGrant` that made a second
revocation a silent no-op, and a direct `steward_id` write that restored a dead child.

## Run it

```
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 \
CUSTOMER_AGENT_PG15_BIN=/Users/hutou/homebrew/opt/postgresql@15/bin \
pnpm --filter @customer-agent/api exec vitest run tests/authorization-reachability.integration.test.ts
```

About five seconds. It builds its own disposable PostgreSQL 15 cluster and never touches an
environment database.

## How it works

A breadth-first search over **operation sequences up to length 5** across this alphabet, each
step driving the real entry points from `apps/api/src/content-intake/authority.ts`:

| Operation | Real call |
| --- | --- |
| `grantChild` | `createGrants(manager, …)` — manager hands the action to the supervisor |
| `revokeDelegationNoSuccessor` | `changeGrant(issuer, delegation, { change: 'revoke', stewardPrincipalId: null })` |
| `revokeDelegationWithSuccessor` | same, with `stewardPrincipalId: 'issuer'` |
| `revokeChild` | `changeGrant(issuer, child, { change: 'revoke' })` |
| `takeoverChild` | `changeGrant(issuer, child, { change: 'takeover', stewardPrincipalId: 'issuer' })` |

State deduplication keeps it to ~12 distinct states. Savepoints make each branch one
`ROLLBACK`, so the whole search is a single transaction. After every reachable state the test
asks the live SQL functions — `authorization_sources`, `authorization_deadline` — for the
answer, and reads the grant rows for the shape.

The bootstrap rows (one root allocation, two business grants, one delegation, one allocation)
are fixture inserts, because that is the state an operator starts from. Everything after them
goes through the real functions.

## Reading a failure

The assertion message is the counterexample, in the code's words:
`<sequence>: <which promise broke>`.

```
initial → grantChild → revokeDelegationWithSuccessor: authorized under a revoked parent
```

Read it as: starting from a fresh bootstrap, granting the supervisor a child and then revoking
the delegation while naming a successor leaves the child authorized. The sequence is the
shortest one the search found.

Three messages exist:

| Message | Promise | Where to look |
| --- | --- | --- |
| `authorized under a revoked parent` | P1 | the parent-liveness clause in `authorization_sources` / `authorization_deadline` |
| `authorized child has no steward` | P1 | `changeGrant`'s child-steward update, and the steward clause in both functions |
| `set says X, deadline says Y` | P2 | whichever of the two functions was edited |
| `version or revocation drift` | P1/P2 | `grant_version_guard`, or an operation that clears `revoked_at` |

**A finding stays a finding.** Report it with the sequence. Do not widen the search, weaken the
promise, or edit the fixture until it passes.

### Not a property failure

`DatabaseMigrationError: Database migration verification failed: exact function
definition/owner/security manifest [282:<digest>]` means the function body changed and the
digest in `packages/database/src/verifier.ts` (`READINESS_INVENTORY_BY_LENGTH[57].functionSha256`)
still describes the old body. The property never ran. This is the repository's exact-function
gate, not a disagreement. Update the digest for the current migration count, rebuild
`pnpm --filter @customer-agent/database build:runtime`, and rerun. A failure that appears
*after* that is the property doing its job.

## What it covers

| Piece | Where |
| --- | --- |
| The search and its invariants | `apps/api/tests/authorization-reachability.integration.test.ts` |
| `createGrants`, `changeGrant`, `issuingParent`, `parentAuthority` | `apps/api/src/content-intake/authority.ts` |
| `authorization_sources` | last defined in `packages/database/overlays/0057_role_ceiling.sql` |
| `authorization_deadline` | last defined in `packages/database/overlays/0057_role_ceiling.sql` |
| `grant_parent_guard` | last defined in `packages/database/overlays/0057_role_ceiling.sql` |
| `content_intake.role_ceiling` and its four predicates | `packages/database/overlays/0057_role_ceiling.sql` |

**Last definition wins.** Migrations are cumulative, so an overlay that looks authoritative may
already be superseded: `0055` owns nothing after `0057` lands. Check with
`rg -l "FUNCTION content_intake\.<name>\(" packages/database/migrations/*.sql | sort | tail -1`
before deciding which file to edit, and never edit a migration that already applied — add a new
one.

**Sync commit: `4afab812`** plus the uncommitted working tree that adds migrations 0054–0057.
Both function bodies and the bootstrap fixture were read and confirmed at that state. Once
those migrations land, replace this line with the landing commit. Move it forward only after
rerunning the check and confirming that the covered files still define the same behaviour; if a
covered function changed, rerun first and only then move the commit.

## What it does not cover

- **Expiry.** The search holds one clock instant; no operation moves time, and no grant expires
  mid-search. Windows and lease deadlines are covered by
  `tests/publish-deadline.integration.test.ts`, `tests/import-deadline.integration.test.ts`, and
  `tests/grant-issuer-deadline.integration.test.ts`.
- **HTTP and the desktop.** The search calls the service layer, not routes or preload. Route
  admission is covered by `tests/route-admission.test.ts`; the desktop projection by
  `tests/authorization-actions-projection.integration.test.ts`.
- **The roster signer path.** Grants issued by `issue_roster_query` with
  `parent_grant_id IS NULL` are outside the alphabet; they are covered by
  `tests/project-roster-login.integration.test.ts`.
- **Other actions, scopes, tenants.** One action (`publish`), one scope, one tenant. The ceiling
  applies per action, so a role-band change is exercised through this one action; a scope or
  tenant bug is not.
- **Concurrency.** The search is serial. Interleaved transactions are covered by the existing
  deadline suites.
- **The role ceiling's values.** This check proves sequences cannot break the two promises. It
  does not prove the ceiling says the right thing about each role; that is
  `tests/role-ceiling.integration.test.ts` (the two copies agree) plus the integration suites
  (the values are right).

## When a change is intended

To widen the search, add an operation to `OPS` and raise `MAX_DEPTH`. Keep each operation a
real call into the service layer, never a hand-written `UPDATE`: the value of this check is that
it exercises the code paths an operator triggers.

If a covered function is replaced by a new migration, update the "What it covers" table and the
sync commit in the same change.
