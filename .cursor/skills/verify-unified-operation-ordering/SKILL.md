---
name: verify-unified-operation-ordering
description: Exhaustively verify the ARC-01 operation envelope's authorization linearization, session epoch, idempotency identity, unknown commit, duplicate submission, recovery, and terminal transitions. Use before ACL-01 or DSH-01 consumes the operation contract.
---

# Verify unified operation ordering

This checker protects the ordering contract ACL-01 and DSH-01 will consume. It does not
modify the runtime, migrations, contracts, ACL, or DSH.

## Run it

From the repository root, with Node.js 24:

```sh
pnpm test:unified-operation-ordering
```

Exit code `0` means the exhaustive model found no violation, every terminal state was
reachable, all seven negative controls produced their expected counterexample, the exact unified
and nested seat source manifests matched, the BASEFIX dependency owned its single test source,
the BASEFIX+FOR identity replay passed 38/38, and the receipt's source commit was an ancestor of
the tested clean head. Exit code `2` means any required receipt/fixture/source is missing or
undeclared, a source drifted, the unified manifest claimed a BASEFIX-owned file, only declared
receipt/evidence files did not change after the source commit, the model lost required coverage,
or a deliberately broken control failed to fail. There is no missing-receipt bootstrap mode.

To emit a machine-readable report bound to the exact tested head:

```sh
node .cursor/skills/verify-unified-operation-ordering/scripts/check.mjs \
  --report /tmp/for-01-verifier-report.json
```

The model imports these ARC-01 predicates directly from the compiled contract package:

- `OPERATION_TRANSITIONS` owns every state edge.
- `classifyOperationReuse` owns new/replay/conflict/stale-session classification.
- `parseOperationStatus` validates every reachable status and terminal receipt shape.

Event ordering and property checks are model-owned. There is no second transition or reuse
policy table.

## Properties

| Property | Failure name |
| --- | --- |
| A command and its effect require a successful authorization decision | `accept_without_authorization`, `write_without_authorization` |
| Acceptance is available only before revocation; the model records that acceptance preceded revocation | `accept_after_revocation` |
| An accepted request may finish after revocation; a request checked after revocation is denied | ordered `acceptedBeforeRevocation` / `admittedWriteAfterRevocation` witnesses plus the real seat replay |
| Same operation identity and request replay while accepted, running, unknown, or committed without a second effect and with the operation's terminal receipt | `duplicate_committed_effect`, `duplicate_effect_or_receipt_drift` plus three in-flight witnesses |
| Actor, command, or request-hash changes conflict | `*_mismatch_not_rejected` |
| A stale session epoch is rejected even with the same operation ID and idempotency key | `sessionEpoch_mismatch_not_rejected` |
| Unknown commit stays unknown until a durable receipt or status lookup resolves it; this includes `running + effects=1 + durable=none` | `unresolved_unknown_reported_terminal` |
| Recovery returns the original committed result or stays unknown, never inferring success from in-memory effects | `recovery_invented_success` |
| Unknown expires only after a status lookup found no terminal receipt; a durable committed receipt can never expire | `unknown_expired_without_lookup` |
| Accepted, running, committed, unknown, failed, cancelled, and expired are both reachable and terminal states have no outgoing contract edges | `MODEL_COVERAGE` plus contract validation |

## Negative controls

The checker mutates one decision at a time and requires a counterexample:

| Broken decision | Required finding |
| --- | --- |
| Accept without the authorization check | `accept_without_authorization` |
| Accept after `checkAuthorization -> revokeAuthorization` | `accept_after_revocation` |
| Let a duplicate submission attempt a second effect | `duplicate_committed_effect` |
| Expire an uncertain post-effect operation without first looking up a receipt | `unknown_expired_without_lookup` |
| Ignore session epoch during reuse classification | `sessionEpoch_mismatch_not_rejected` |
| Ignore request-hash binding during reuse classification | `requestHash_mismatch_not_rejected` |
| Report recovery success after a lost post-effect commit without a durable receipt | `recovery_invented_success` |

## Evidence boundary

The exhaustive part covers only the finite operation envelope and its event interleavings. It
does not prove PostgreSQL MVCC, network partitions, process death during COMMIT, filesystem
durability, HTTP parsing, IPC, or a runtime operation store that does not yet exist.

Real PostgreSQL 15 behavior is replayed by:

```sh
pnpm test:seat-administration-revocation
pnpm --filter @customer-agent/api exec vitest run \
  tests/authorization-reachability.integration.test.ts
```

The seat replay proves an already admitted command may finish after revocation and a command
checked after revocation is denied, using real authorization, identity-write, grant-revocation,
and password-file code. The reachability replay drives the real grant lifecycle up to depth
five. The manual identity command covers the seat/identity admission boundary and always checks
the fixed BASEFIX test correction. The formal checker constructs a
fresh `git archive` of the tested head, verifies BASEFIX's parent ancestry and exact one-file
patch and blob hash, then runs the nine-file identity command. Before BASEFIX is an ancestor, the
checker replaces only that test blob. After BASEFIX becomes an ancestor, it runs the tested head
file so later migrations test their real combined behavior. The supporting module owns the
BASEFIX commit, file hash, test manifest, and 9/38 expectation. The
unified source manifest deliberately excludes this file. Any missing commit, incorrect
relationship, ownership overlap, or non-38/38 result fails closed. When BASEFIX is not an
ancestor, the checker overlays its immutable blob. When it is an ancestor, the checker runs the
tested head file, so later migrations test their real combined behavior. Neither replay pretends
the ARC-01 operation envelope is already persisted in product runtime.

`receipts.json` binds the model, focused test, ARC-01 predicates, authorization and identity
consumers, real replay sources, migration inputs, commands/results, environment, and reported
state count by SHA-256. It recursively verifies the seat-administration receipt and all of that
receipt's source hashes, with exact declared manifests on both levels. Git checks require
`syncCommit` to be an ancestor of the exact tested head and reject any source change after it;
only the two receipt files may change in the evidence commit. The generated report records the
tested head, source receipt, model counts, witness paths, negative controls, BASEFIX integration
result, and zero error count. Update the receipt only after rerunning the checker and reading
the changed sources.
