---
name: verify-store-set-advance
description: Exhaustively check that advancing content_intake.store_set_current never strips an operator's import or publish authority, and record whether a dropped source's query authority comes back. Use when changing project_feishu_roster, issue_roster_query, restamp_query_grants, authorization_deadline, store_set_* tables, or migrations 0048/0049/0059/0057.
---

# Every store-set advance keeps the upload route open

**Property P1.** In every reachable state, a principal holding live manual `import` and `publish` grants on a source keeps a non-null `authorization_deadline` for that source while their facts are fresh. *Harm if broken:* the operator picks a workbook, another person logs in, the store set advances, and publish silently stops working mid-flight.

**Property P2.** When a source is a member of the current store-set version, a live manual `query` grant on it authorizes. *Harm if broken:* one advance that omits the source sets `revoked_at` forever, so republishing the source does not restore search and the operator must be re-granted by hand.

Both were found on 2026-10-23 against production `customer_agent_formal`, where a roster login promoted version 4 with zero members and `restamp_query_grants` revoked the only query grant. Migration `0062_store_set_authority_retention` fixes both, and the negative control below is the only remaining way to see them fail.

## Run it

```
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 \
CUSTOMER_AGENT_PG15_BIN=/Users/hutou/homebrew/opt/postgresql@15/bin \
CI=true pnpm --filter @customer-agent/api exec vitest run tests/store-set-advance.integration.test.ts
```

About two seconds. It builds its own disposable PostgreSQL 15 cluster, applies the real migrations, and never touches an environment database.

Expected: three tests pass. The walk reaches 13 distinct states and reports no findings.

## How it works

`apps/api/tests/store-set-advance.integration.test.ts` seeds the version 1 shape an operator starts from: one `v2-preview` source that is a member, an `engineer` role rule, and `import` / `publish` / `query` business grants issued by a separate admin principal. Each grant derives from its own allocation, because `grant_parent_guard` requires the parent action to match the child's and forbids self-issued business grants.

It seeds two readable sources so a version can drop one and still keep a member, then walks every sequence of advances up to depth 4 over the four membership subsets of `{source, other}`. Each step inserts a `store_sets` row, its members, and updates `content_intake.store_set_current`, which is the single write a roster login performs and the statement `restamp_query_grants` watches. Branches are undone with `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` inside one transaction, and states are deduplicated on `(current members, revoked actions, query decision)`, so the walk stops at the reachable fixed point instead of exploring duplicate paths.

After each state it calls the real `content_intake.authorization_deadline` at a timestamp inside the facts window, and records violations rather than throwing, so one run reports the whole space. P1 asserts the `import_lost` list is empty. P2 asserts the `query_not_restored` list is empty.

## Seeing it fail

The check ships with its own negative control. `installBrokenDeadline` replaces `authorization_deadline` with a variant that requires current store-set membership for every action:

```
CUSTOMER_AGENT_STORE_SET_BREAK=1 \
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 \
CUSTOMER_AGENT_PG15_BIN=/Users/hutou/homebrew/opt/postgresql@15/bin \
CI=true pnpm --filter @customer-agent/api exec vitest run tests/store-set-advance.integration.test.ts
```

P1 then fails with `{} :: members=[] revoked=[query]`. That is the check catching a real break, not a modeling error.

To see the recorded P2 finding in full:

```
CUSTOMER_AGENT_STORE_SET_VERBOSE=1 ... (same command)
```

It prints `states=3` and the counterexample `{} → {source} :: source is a current member but query is denied; revoked=[query]`.

## Coverage

| Check | Code |
| --- | --- |
| The write every roster login performs | `UPDATE content_intake.store_set_current` inside `content_intake.project_feishu_roster`, `packages/database/overlays/0049_roster_lifecycle.sql` |
| The revoking pass | `content_intake.restamp_query_grants`, replaced by `packages/database/overlays/0062_store_set_authority_retention.sql` |
| The empty-promotion guard | `content_intake.store_set_keep_members`, same migration |
| The decision under test | `content_intake.authorization_deadline`, `packages/database/overlays/0057_role_ceiling.sql` |
| Table shapes | `store_sets`, `store_set_members`, `store_set_current` in `packages/database/overlays/0048_roster_store_set.sql` |

Last confirmed that this description matches that code: `74b7d55b79c76f1e1843cd1d58d4c8f05f534e21`.

Move that commit forward only after you open the listed files at the new commit and confirm the walk still describes them. A green run after those functions were rewritten without updating this file is not evidence.

## Reading a failure

- `import_lost` means authority disappeared on an advance. Check whether the advance promoted a version whose member set omits the source while the grant still names it.
- `query_not_restored` means the grant was terminally revoked. Before `0062`, `restamp_query_grants` wrote `revoked_at = v_now` when the source was not a member, and nothing ever cleared it.
- Any error out of `seed()` naming a constraint means the schema moved, not that the property regressed. Re-read the migration before touching the test.

## Not covered

- The five-minute facts lease. `principal_facts_check` caps every window at `checked_at + 5 minutes`, so every property here is evaluated at a single fresh instant. A real upload that outlives that window fails for a reason this check does not model.
- The roster path's own grant issuance. This walk drives the tables and the trigger; it does not call `project_feishu_roster` or `issue_roster_query`, which also read `release_lineage` and `content_current`.
- Any tenant or app other than the one seeded here, and any source count above one.
- `authorization_sources`, the other decision shape. `authorization-set-agreement` covers that pair.
