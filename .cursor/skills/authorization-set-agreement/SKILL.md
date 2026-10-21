---
name: authorization-set-agreement
description: Verify that content_intake.authorization_sources and content_intake.authorization_deadline give the same yes/no answer. Use when changing either function, the grants/principal_facts/store_sets tables, or any door that reads them (apps/api/src/content-intake/usage.ts, overlays 0051/0052/0053, apps/api/src/project-roster-login.ts).
---

# Two authorization shapes must agree

One command checks it:

```
CUSTOMER_AGENT_DB_PG15_INTEGRATION=1 \
CUSTOMER_AGENT_PG15_BIN=/Users/hutou/homebrew/opt/postgresql@15/bin \
pnpm --filter @customer-agent/database exec vitest run tests/authorization-set-agreement.test.ts
```

It takes about five seconds, spins up its own disposable PostgreSQL 15 cluster, and never
touches an environment database.

## What it checks, in one sentence

For the same principal, action and instant, `authorization_sources` must list exactly the
(scope, source) pairs for which `authorization_deadline` returns a timestamp.

## Why a drift harms users

Search, publish, import, the workbench button bits and the intake query surface the shipped
capsule calls all read the set. The deadline still guards the grant-issuer path and the
intake runtime's own checks, so both shapes remain load-bearing. If they drift, one door
serves a source another door refuses: an operator sees a script in one window and is told
they have no access in the next, for the same person at the same moment.

## What the check covers

| Piece | Where it lives |
| --- | --- |
| `content_intake.authorization_sources(text,text,timestamptz)` | `packages/database/overlays/0050_authorization_sources.sql` |
| `content_intake.authorization_deadline(text,text,text,text,timestamptz)` | `packages/database/migrations/0048_roster_store_set.sql` (body), `0044_intake_role_defaults.sql` (ceiling) |
| Tables both read | `principals`, `principal_facts`, `grants`, `scopes`, `sources`, `role_rules`, `policy_versions`, `store_sets`, `store_set_current`, `store_set_members` |
| Doors that depend on the agreement | `apps/api/src/content-intake/usage.ts` (now the set, one clock per request), `overlays/0051_publish_source_set.sql`, `0052_import_source_set.sql`, `0053_search_source_set.sql`, `apps/api/src/project-roster-login.ts` (set); grant issuance through `apps/api/src/content-intake/authority.ts` (deadline) |

**Last confirmed against the code at commit `fe360e59`.** Move that commit forward only
after running the check and confirming both function bodies are the ones you just read. If
`git log fe360e59..HEAD -- packages/database/overlays/0050_authorization_sources.sql packages/database/migrations/0048_roster_store_set.sql packages/database/migrations/0044_intake_role_defaults.sql packages/database/tests/authorization-set-agreement.test.ts`
prints anything, look again before trusting a green run.

## How to read a failure

fast-check prints a shrunk counterexample, then the assertion names each disagreement:

```
publish scope-agreement-a/source-agreement-b: deadline=null set=present
  [business/publish/source-agreement-a] role=director facts=enabled
```

Read it as: a business publish grant naming `source-agreement-a`; the deadline refuses the
sibling source `source-agreement-b`, the set offers it. The bracketed shape lists every
grant the case had, with `/revoked` when it was withdrawn, and the trailing fields name the
facts state and the principal's role.

## Real bug or modeling error

- **Real bug.** The generator produced a configuration the schema allows, and the two
  functions disagree about it. Fix the function that is wrong; do not edit the assertion.
- **Modeling error.** The run throws instead of reporting a disagreement. That means the
  fixture tried to insert a row the schema forbids: a facts window longer than five minutes
  or not after `checked_at`, a business grant without a matching allocation parent, a
  business grant whose issuer equals its recipient, or two role rules for one job (the
  table is keyed by tenant, app, department, job). Fix the generator; a case the schema
  rejects proves nothing.
- **A restored-function failure.** The third case deliberately replaces the set function
  with a drifted variant, asserts the property reports it, then restores the real body. A
  failure after that point means the restore did not take, not that the product is broken.

## When a change is intended

Changing either function body also changes the exact-function manifest the migration verifier
asserts. Before the property can run you must update the digest for the current migration
count in `packages/database/src/verifier.ts`:

- `READINESS_INVENTORY_BY_LENGTH[53].functionSha256` — the function definition/owner/security
  manifest digest.
- `READINESS_ACL_BY_LENGTH[53]` — only if a grant changed, not just a body.

While the digest is stale the suite fails with `DatabaseMigrationError: Database migration
verification failed: exact function definition/owner/security manifest [278:<digest>]` and the
property never executes. That message is not a disagreement; it tells you the digest needs
the value it just printed. Update it, rebuild `build:runtime`, rerun. A failure that appears
*after* that update is the property doing its job.

If a change intentionally alters what a principal may reach, change `authorization_sources`
and `authorization_deadline` in the same commit and keep them answering alike. A commit
that changes only one of them is the bug this check exists to catch; if you truly mean to
change only one, the doors must stop sharing the answer, which needs a decision from the
operator before you touch this test.

After an intended change passes, move the sync commit above to the new HEAD.

## What it does not cover

- **One clock per request at the call site.** The property calls both functions with one
  `p_at`, so it says nothing about callers. Every door now captures its instant before
  reading a set; if you add a call site, capture one instant and pass it, never
  `clock_timestamp()` inside a row projection. This check will not catch a mistake there.
- **Cross-door behaviour.** It does not publish, search or import. It only proves the two
  authorization shapes agree; whether each door applies its shape correctly is covered by
  `apps/api/tests/search-query-deadline.integration.test.ts`, `publish-deadline`,
  `import-deadline` and `grant-issuer-deadline`.
- **The role ceiling's intent.** It checks that whatever ceiling each function applies
  produces the same answer, not that the ceiling is the right policy.
- **Performance.** Not measured here.
