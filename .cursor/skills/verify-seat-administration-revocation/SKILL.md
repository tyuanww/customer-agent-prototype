---
name: verify-seat-administration-revocation
description: Verify the selected request-time authorization semantics for Settings seat create, reset, and disable, while retaining the stricter no-write-after-revocation property as a safety candidate. Use when changing seats.ts, seat_administration_allowed, authority revocation, or the password-file boundary.
---

# Verify request-time seat administration authorization

**Property P1.** A Settings seat command may write only after
`content_intake.seat_administration_allowed` returns `true`. That successful server-side check
is the authorization linearization point. A later revocation does not cancel the admitted
command, and a command checked after revocation fails.

**Harm if broken.** A revoked administrator can start a new seat command, or the service can
write identity state without any successful authorization check.

The selected product policy is request-time authorization. The stricter alternative remains a
safety candidate.

- **Request-time authorization.** A command admitted while authority is live may finish after
  revocation. New commands fail at their own preflight check.
- **Commit-time authorization.** A command may write only while authority is still live at
  every durable database or password write.

The current code follows request-time authorization and does not satisfy commit-time
authorization.

## Run it

From the repository root:

```sh
CUSTOMER_AGENT_PG15_BIN="${CUSTOMER_AGENT_PG15_BIN:-$(brew --prefix postgresql@15)/bin}" \
pnpm test:seat-administration-revocation
```

The command takes about 10 seconds, builds the compiled API/database modules, starts a
disposable PostgreSQL 15 cluster, and never accesses an environment database.

Exit codes:

- `0` means request-time authorization held for create, reset, and disable, both negative
  controls were detected, and password-file failure preserved the expected identity boundary.
- `1` means the selected request-time policy failed.
- `2` means the model is stale, the fixture could not run, or a negative control failed to
  detect a deliberately broken ordering. This is not a product finding.

## Tool choice

The check uses a dependency-free finite-state exhaustive model checker in Node. The scoped
question has four monotonic events, one request, one revocation, and no retry or timeout, so
enumerating every action order is cheaper and easier to audit than installing TLC. A separate
real PostgreSQL replay confirms that the modeled shortest path can occur through
`createSeatService`.

If the model is later replaced with TLA+, read every result with `/statechart`.

## What the model checks

The model state records whether the request started, the authorization result, whether
authority was revoked, and whether identity or password state was written. It explores every
order without a depth bound because every action is monotonic and can occur at most once.
The ordering represents network delay without timing assumptions. A delayed request whose
server-side check runs after revocation fails. A delayed write after a successful check may
complete under the selected request-time policy.

The primary request-time model passes. Two deliberately broken variants prove the detector can
fail:

| Variant | Expected finding |
| --- | --- |
| Remove the administration check | `write_without_admin_check` |
| Move the identity write before the check | `write_before_admin_check` |

The stricter `commit-time authorization` candidate reaches:

```text
startRequest -> checkAdministration -> revokeAdministration -> writeIdentity
```

The command prints this path as `SAFETY_CANDIDATE`. It does not fail the selected request-time
policy.

## Real-code replay

`scripts/check.mjs` applies the real migrations to an isolated PG15 cluster. It repeats create,
reset, and disable for four authority removals: current organization facts, an allocation
grant, the role rule, and the administrator binding. Each scenario then:

1. Lets the real `seat_administration_allowed` query return `true`.
2. Holds that result at a test-only pool barrier.
3. Applies the selected authority removal through PostgreSQL. The facts case uses the real
   organization facts writer. The other cases update the real grant, role-rule, or binding row
   that the authorization function reads.
4. Confirms `seat_administration_allowed` now returns `false`.
5. Releases the barrier and records the already-admitted command's completion.
6. Starts the same command after revocation and requires `SEAT_FORBIDDEN` with no side effect.

The create, reset, and disable scenarios use the real `create_seat`, password-file adapter, and
`disable_seat` paths. The check also:

- Runs two admitted administrators through create with one shared password file. Both identity
  rows and both password rows must remain.
- Starts two admitted creates for the same username behind the same preflight barrier. Exactly
  one may complete; the other must return `SEAT_EXISTS` instead of the raw PostgreSQL `23505`.
- Starts two child writer processes behind a held lock. Both writes must complete after release,
  which detects lost read-modify-write updates.
- Marks a live lock holder with an owner token and an old modification time. A second writer must
  wait and must not steal the lock.
- Leaves a stale lock and verifies that the next writer removes it and applies its update.
- Forces a password-file write to fail. Create must report `SEAT_PASSWORD_NOT_WRITTEN` after
  preserving the committed identity. Reset must report the same reason without a database
  identity change.

The barrier is verification scaffolding. It does not change product code or add a production
hook.

## Receipts

`receipts.json` stores SHA-256 hashes for every covered source file and the commit at which the
model was last checked. The command fails with exit `2` when any hash drifts. After an intended
code change:

1. Read the changed implementation and update the model only if the semantics changed.
2. Rerun the check.
3. Move the sync commit and hashes forward only after the model describes the new code.

`models/seat-revocation.mjs` owns the state machine and invariants.
`scripts/check.mjs` owns the real PostgreSQL replay and exit-code contract.

## Coverage

| Piece | Where |
| --- | --- |
| Authorization check and command ordering | `apps/api/src/content-intake/seats.ts` |
| Seat HTTP entry points | Covered by `apps/api/tests/seat-service.test.ts`, outside this formal replay |
| Identity creation, listing and disable functions | `packages/database/migrations/0068_seat_lifecycle.sql` |
| Authority change | `apps/api/src/content-intake/organization/facts-writer.ts` |
| Grant revocation and version guard | `apps/api/src/content-intake/authority.ts`, `packages/database/migrations/0058_grant_steward_no_restore.sql` |
| Password-file boundary | `apps/api/src/content-intake/seat-password-file.ts` |

## Completion boundaries

Request-time authorization decides who may start a command. Each command still has its own
completion boundary.

- `create` is complete after the database identity commits and the password file upsert
  succeeds. If the password write fails, the identity remains and the operator must reset the
  password. `SEAT_PASSWORD_NOT_WRITTEN` reports this partial state. A process crash after the
  database commit has the same recovery path.
- `reset` is complete after the password file upsert succeeds. The database only checks that
  the seat exists; reset does not commit identity state. Atomic rename leaves either the old
  complete file or the new complete file, never a partial JSON document.
- `disable` is complete after the database disables the binding. The password entry stays, and
  login admission rejects the disabled binding.

The password file has one writer across API processes. A sibling lock directory serializes each
read-modify-write. Writers compute the password hash before entering the short critical section.
The lock has a 10-second acquisition timeout. The lock directory records a random owner token and
the process ID. A live process keeps its lock even when the directory timestamp is old. A dead
process is reclaimed immediately. A directory with no readable owner is reclaimed only after
30 seconds. Release removes the directory only when its token still belongs to the current writer.

Temporary files are synced and then renamed over the account file. The parent directory is synced
on macOS and Unix. The next writer removes interrupted temporary files with the target prefix.
Windows directory syncing is outside the verified power-loss boundary.

PostgreSQL and the password file cannot share one transaction. A crash between the two writes
therefore has an explicit partial state. Process crashes do not corrupt password JSON, but power
loss after the rename is outside the filesystem durability guarantee proved by this check.

## What it does not cover

- Two complete API server processes with a real network partition, database failover, or
  transactional multi-command behavior. PostgreSQL statements and password-file writes are
  checked in one process, and the password-file writer is also checked in child processes.
- Database isolation beyond the explicitly controlled interleaving. The model proves the
  ordering property; the replay proves that each selected revocation and admitted completion
  path is reachable with the real functions.
- A kill while PostgreSQL is committing or while the filesystem renames the password file.
  The checks verify live-owner exclusion, dead-owner recovery, and deterministic command failure
  paths.
- A commit-time implementation that rechecks authority inside each write transaction or holds a
  shared lock across the database and password-file writes. The selected product policy is
  request-time authorization.
- HTTP request parsing, response status mapping, preload validation, Main sender checks, and
  renderer behavior. Their focused unit, component, and Electron tests own those boundaries.

The current UI cannot revoke a root allocation through `changeGrant`. The direct allocation
revocation in this verifier uses the owning PostgreSQL connection to replay the database
authority change. Product UI support for root allocation changes remains out of scope.
